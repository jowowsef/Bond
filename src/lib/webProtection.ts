import { Platform } from 'react-native';
import BondWeb, { type WebStatus } from '../../modules/bond-web';
import { supabase } from './supabase';

/**
 * WEB PROTECTION (adult websites), on THIS phone only.
 *
 * Runs on the phone as a DNS-only local VPN (modules/bond-web). Turning it on
 * needs the phone owner's own "Allow" in Android's VPN dialog; nobody can do
 * that for them, and Bond can't change anything on the partner's phone.
 *
 * Privacy: Bond never records or uploads which sites are visited. The only
 * thing shared with the partner is whether protection is currently on
 * (device_permissions.website_protection_running), so they're not misled.
 */

export type WebSupport = 'ready' | 'needs-update' | 'unsupported';
export type { WebStatus };

export function getWebSupport(): WebSupport {
  if (Platform.OS !== 'android') return 'unsupported';
  return BondWeb ? 'ready' : 'needs-update';
}

export function readWebStatus(): WebStatus | null {
  if (!BondWeb) return null;
  try {
    return BondWeb.getStatus();
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait (briefly) until the service reports the wanted state. */
async function waitFor(running: boolean, timeoutMs = 4000): Promise<WebStatus | null> {
  const end = Date.now() + timeoutMs;
  let s = readWebStatus();
  while (s && s.running !== running && Date.now() < end) {
    await sleep(250);
    s = readWebStatus();
  }
  return s;
}

export type WebResult = { ok: true; status: WebStatus } | { ok: false; message: string; status: WebStatus | null };

/** Ask Android for the VPN permission if needed, then start the filter and confirm it runs. */
export async function turnOnWebProtection(): Promise<WebResult> {
  if (!BondWeb) return { ok: false, message: 'Web Protection needs the latest version of Bond on this phone.', status: null };
  let allowed = false;
  try {
    allowed = await BondWeb.requestPermission();
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return {
      ok: false,
      message: 'Android did not allow the VPN connection, so Web Protection is still off. Nothing else was changed.',
      status: readWebStatus(),
    };
  }
  if (!BondWeb.enable()) {
    return { ok: false, message: 'Android did not allow the VPN connection. Please try again.', status: readWebStatus() };
  }
  const status = await waitFor(true);
  if (!status?.running) {
    return {
      ok: false,
      message: 'Web Protection could not start. If another VPN app is on, turn it off and try again.',
      status,
    };
  }
  return { ok: true, status };
}

export async function turnOffWebProtection(): Promise<WebResult> {
  if (!BondWeb) return { ok: false, message: 'Web Protection is not available in this version of Bond.', status: null };
  BondWeb.disable();
  const status = await waitFor(false);
  if (status?.running) return { ok: false, message: 'Web Protection is still stopping. Check again in a moment.', status };
  return status ? { ok: true, status } : { ok: false, message: 'Could not read the current state.', status: null };
}

export function openVpnSettings(): void {
  BondWeb?.openVpnSettings();
}

export function openNetworkSettings(): void {
  BondWeb?.openNetworkSettings();
}

/** Share ONLY on/off with the partner (no browsing data, ever). */
export async function shareWebStatus(userId: string, status: WebStatus | null): Promise<void> {
  if (!status) return;
  await supabase.from('device_permissions').upsert({
    user_id: userId,
    vpn_permission: status.permissionGranted,
    website_protection_running: status.running,
    updated_at: new Date().toISOString(),
  });
}

export type PartnerWebStatus = { running: boolean; updatedAt: string } | null;

/** What the partner's phone last reported (null = never reported). */
export async function readPartnerWebStatus(partnerId: string): Promise<PartnerWebStatus> {
  const { data, error } = await supabase
    .from('device_permissions')
    .select('website_protection_running, updated_at')
    .eq('user_id', partnerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { running: !!data.website_protection_running, updatedAt: data.updated_at as string };
}
