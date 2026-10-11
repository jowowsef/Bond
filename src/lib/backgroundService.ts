import { readCurrentAppSetting } from './currentApp';
import {
  currentAppServiceAvailable,
  serviceModes,
  startCurrentAppService,
  stopCurrentAppService,
  updateServiceModes,
  type ServiceModes,
} from './currentAppServiceControl';
import { getUsageSupport, hasUsageAccess } from './screenTime';
import { supabase } from './supabase';

/**
 * WHEN Bond's one background service runs, and which parts (decided in the
 * open app; the background task applies the same rules on its own):
 *  - app checks: Currently Using sharing ON (server) + Android Usage access;
 *  - battery:    battery sharing ON (server). Needs no Android permission.
 * Both off = the service is stopped. Granting an Android permission never
 * turns any sharing on; only the person's own switch does.
 * Called only while paired with setup finished (the caller passes null
 * otherwise, which stops everything).
 */
export function desiredModes(s: {
  currentAppOn: boolean;
  usageAccess: boolean;
  batteryOn: boolean;
}): ServiceModes {
  return { apps: s.currentAppOn && s.usageAccess, battery: s.batteryOn };
}

let running: Promise<ServiceModes | null> | null = null;

/**
 * Bring the service in line with the person's settings. Safe to call often
 * (calls share one run). Returns what should run now, or null if unknown
 * (offline: nothing is changed).
 */
export function reconcileBackgroundService(userId: string | null, partnerName: string): Promise<ServiceModes | null> {
  if (!running) {
    running = run(userId, partnerName).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(userId: string | null, partnerName: string): Promise<ServiceModes | null> {
  if (!currentAppServiceAvailable()) return null; // older build: the earlier checks still work
  if (!userId) {
    await stopCurrentAppService();
    return { apps: false, battery: false };
  }
  const [app, battery] = await Promise.all([
    readCurrentAppSetting(userId),
    supabase.from('privacy_settings').select('share_battery').eq('user_id', userId).maybeSingle(),
  ]);
  if (app.kind === 'error' || battery.error) return null; // can't tell: change nothing
  const want = desiredModes({
    currentAppOn: app.kind === 'on',
    usageAccess: getUsageSupport() === 'ready' && hasUsageAccess(),
    batteryOn: !!(battery.data as { share_battery?: boolean } | null)?.share_battery,
  });
  const now = serviceModes();
  if (!want.apps && !want.battery) {
    if (now.running) await stopCurrentAppService();
    return want;
  }
  if (now.running && now.apps === want.apps && now.battery === want.battery) return want;
  // Running: change its parts. Not running: start it (Bond is open here).
  if (!(now.running && (await updateServiceModes(want)))) await startCurrentAppService(partnerName, want);
  return want;
}
