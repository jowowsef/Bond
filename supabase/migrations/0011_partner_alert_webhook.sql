-- =====================================================================
-- 0011: Push partner alerts through the send-partner-alert Edge Function
--       (direct pg_net trigger; replaces the Dashboard "Database Webhook")
--
-- Why: Dashboard Database Webhooks need the "supabase_functions" schema,
-- which Supabase only creates when the Database Webhooks integration is
-- enabled for the project. It doesn't exist in this database, so the
-- Dashboard can't create the webhook. A webhook is only a trigger that calls
-- pg_net, so this migration adds that trigger directly, with nothing else.
--
-- What it does: after a row is INSERTED into public.partner_alerts (a low
-- battery alert or an unpair alert, created by the 0003 / 0004 / 0010
-- triggers), it asks pg_net to POST
--     {"type":"INSERT","table":"partner_alerts","schema":"public",
--      "record":{"id":"<alert id>"},"old_record":null}
-- to the existing Edge Function, with the header x-bond-secret. Only the id
-- is sent; the function re-reads the alert itself (title, body, recipient
-- always come from the database). Updates and deletes send nothing.
--
-- Secret: read at run time from Supabase Vault (secret name
-- "bond_alert_webhook_secret"), never written in this file or in the
-- function. Store it in Vault BEFORE or AFTER running this; until it is
-- there, nothing is sent and alerts are still delivered by the app itself.
--
-- Delivery and failures:
--  - pg_net queues the request inside the same transaction and sends it
--    only after COMMIT, so a rolled-back unpair / reading sends nothing, and
--    the function always finds the committed row.
--  - It never blocks or fails the insert: any problem here (Vault missing,
--    pg_net error) is caught and only logged as a warning.
--  - No retries here. If the call fails or the function can't push, the
--    alert stays undelivered and the app delivers it (when open, from the
--    Currently Using service, or Android's background check), as before.
--  - No duplicates: one trigger, one request per alert; the function also
--    "claims" the alert before pushing, and alerts older than 2 hours are
--    never pushed.
--
-- Requires: pg_net (functions in schema "net"), Supabase Vault, and the
-- partner_alerts table (0003, 0010). Safe to run more than once.
-- Does not change any other table, trigger or function.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED:
--   select tgname from pg_trigger
--    where tgrelid = 'public.partner_alerts'::regclass and tgname = 'partner_alert_push';
-- =====================================================================

do $chk$ begin
  if to_regclass('public.partner_alerts') is null then
    raise exception 'partner_alerts is missing: apply 0003 / 0010 first.';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise exception 'pg_net is not enabled (net.http_post not found). Enable the pg_net extension first.';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is not available (vault.decrypted_secrets not found).';
  end if;
end $chk$;

create or replace function public.push_partner_alert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets
   where name = 'bond_alert_webhook_secret'
   limit 1;
  if secret is null or secret = '' then
    return new; -- not configured yet: the app delivers the alert itself
  end if;

  perform net.http_post(
    url := 'https://btlyffysulpaestesxdn.supabase.co/functions/v1/send-partner-alert',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'partner_alerts',
      'schema', 'public',
      'record', jsonb_build_object('id', new.id),
      'old_record', null
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bond-secret', secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Never let push problems block an alert (or an unpair). No secret in the message.
  raise warning 'partner alert push not queued: %', sqlstate;
  return new;
end;
$fn$;

-- Only the trigger runs it; nobody can call it (or read the secret through it).
revoke all on function public.push_partner_alert() from public, anon, authenticated;

drop trigger if exists partner_alert_push on public.partner_alerts;
create trigger partner_alert_push
  after insert on public.partner_alerts
  for each row execute function public.push_partner_alert();
