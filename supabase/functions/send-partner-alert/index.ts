// Supabase Edge Function: send-partner-alert
//
// Sends a push notification for one row of public.partner_alerts.
// Triggered by a Database Webhook on INSERT into partner_alerts.
//
// Security:
//  - Requires the shared secret header `x-bond-secret` (set the same value in
//    the webhook and in the function secret BOND_ALERT_WEBHOOK_SECRET).
//  - Uses ONLY the alert id from the request, then re-reads the alert from the
//    database. Title, body and recipient always come from the database row,
//    so a forged request can't send arbitrary text or reach other users.
//  - The service role key is provided by Supabase to this function at
//    runtime (SUPABASE_SERVICE_ROLE_KEY). It never ships in the app.
// Idempotent: the alert is "claimed" (delivered_at set) before sending, so
// webhook retries and the in-app fallback never deliver it twice.

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // older alerts are not pushed (no flood of stale news)

Deno.serve(async (req) => {
  const secret = Deno.env.get('BOND_ALERT_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-bond-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let alertId: string | undefined;
  try {
    const payload = await req.json();
    alertId = payload?.record?.id ?? payload?.id;
  } catch {
    // fall through
  }
  if (!alertId || !/^[0-9a-f-]{36}$/i.test(alertId)) return new Response('Bad request', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: alert, error } = await admin.from('partner_alerts').select('*').eq('id', alertId).maybeSingle();
  if (error) return new Response('Lookup failed', { status: 500 });
  if (!alert || alert.delivered_at) return new Response('Nothing to send', { status: 200 });

  if (Date.now() - new Date(alert.created_at).getTime() > MAX_AGE_MS) {
    await admin.from('partner_alerts').update({ delivered_at: new Date().toISOString(), delivered_via: 'expired' })
      .eq('id', alertId).is('delivered_at', null);
    return new Response('Too old', { status: 200 });
  }

  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', alert.recipient_id);
  // No device registered for push: leave it unclaimed so the app delivers it.
  if (!tokens || tokens.length === 0) return new Response('No push tokens', { status: 200 });

  // Claim first (only one sender wins), then send.
  const { data: claimed } = await admin
    .from('partner_alerts')
    .update({ delivered_at: new Date().toISOString(), delivered_via: 'push' })
    .eq('id', alertId)
    .is('delivered_at', null)
    .select('id');
  if (!claimed || claimed.length === 0) return new Response('Already delivered', { status: 200 });

  const messages = tokens.map((t: { token: string }) => ({
    to: t.token,
    title: alert.title,
    body: alert.body,
    sound: 'default',
    channelId: 'partner-alerts',
    priority: 'high',
    data: { kind: alert.kind, alertId: alert.id },
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await res.json();
    // Remove tokens Expo reports as no longer valid (app uninstalled, etc.).
    const tickets: Array<{ status: string; details?: { error?: string } }> = result?.data ?? [];
    const dead = tickets
      .map((ticket, i) => (ticket.details?.error === 'DeviceNotRegistered' ? messages[i].to : null))
      .filter((t): t is string => !!t);
    if (dead.length > 0) await admin.from('push_tokens').delete().in('token', dead);
    if (!res.ok || tickets.every((t) => t.status !== 'ok')) {
      // Push failed entirely: release the claim so the app can still show it.
      await admin.from('partner_alerts').update({ delivered_at: null, delivered_via: null }).eq('id', alertId);
      return new Response('Push failed', { status: 502 });
    }
  } catch {
    await admin.from('partner_alerts').update({ delivered_at: null, delivered_via: null }).eq('id', alertId);
    return new Response('Push failed', { status: 502 });
  }

  return new Response('Sent', { status: 200 });
});
