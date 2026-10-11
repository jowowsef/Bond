-- =====================================================================
-- 0004: Partner low-battery alerts are automatic for paired couples.
--
-- Replaces ONLY the trigger function from 0003. The one change: the
-- receiver's privacy_settings.battery_alerts switch is no longer required
-- (the switch was removed from the app). Everything else is identical:
--   - thresholds 20 / 15 / 10 / 5 %, one alert per threshold per discharge cycle
--   - new cycle after charging or rising above 25 %
--   - stale readings (older than 15 minutes) ignored
--   - one alert for the lowest threshold after a missed drop
--   - only the paired partner receives it, and only while the battery's
--     owner shares their battery (privacy_settings.share_battery)
-- The battery_alerts column and its data are left in place (unused).
-- Safe to run more than once. Run it after 0003.
-- =====================================================================

create or replace function public.on_battery_status_alert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  st public.battery_alert_state;
  partner uuid;
  t integer;
  hit integer := null;
  owner_name text;
begin
  if new.level is null or new.level <= 0 or new.level > 100 then return new; end if;
  -- Ignore old readings (e.g. a delayed upload stamped long ago).
  if new.updated_at < now() - interval '15 minutes' then return new; end if;

  insert into public.battery_alert_state (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select * into st from public.battery_alert_state where user_id = new.user_id for update;

  -- Charging, or back above 25%: a new discharge cycle starts.
  if new.is_charging or new.level > 25 then
    if st.lowest_notified is not null then
      update public.battery_alert_state
         set cycle = cycle + 1, lowest_notified = null, updated_at = now()
       where user_id = new.user_id;
    end if;
    return new;
  end if;

  -- The LOWEST threshold reached that wasn't alerted yet this cycle. If the
  -- phone was offline from 40% to 8%, this sends ONE alert (10%), not three.
  foreach t in array array[20, 15, 10, 5] loop
    if new.level <= t and (st.lowest_notified is null or t < st.lowest_notified) then
      hit := t;
    end if;
  end loop;
  if hit is null then return new; end if;

  update public.battery_alert_state set lowest_notified = hit, updated_at = now() where user_id = new.user_id;

  select m2.user_id into partner
    from public.couple_members m1
    join public.couple_members m2 on m2.couple_id = m1.couple_id and m2.user_id <> m1.user_id
   where m1.user_id = new.user_id;
  if partner is null then return new; end if;
  if not coalesce((select share_battery from public.privacy_settings where user_id = new.user_id), false) then return new; end if;

  owner_name := public.display_name_of(new.user_id);
  if owner_name in ('Me', 'Someone', '') then owner_name := 'Your partner'; end if;

  insert into public.partner_alerts (recipient_id, subject_id, kind, threshold, level, cycle, title, body)
  values (partner, new.user_id, 'battery_low', hit, new.level, st.cycle,
          'Low battery', owner_name || '''s battery is at ' || new.level || '%.')
  on conflict (recipient_id, subject_id, kind, threshold, cycle) do nothing;
  return new;
end;
$fn$;
