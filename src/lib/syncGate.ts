import { pairingSetupAllowsSync } from './pairingSetup';
import { supabase } from './supabase';

/**
 * May this account's data be sent right now? Used by everything that sends
 * without a screen open (background jobs, the Currently Using service).
 *
 *  - 'allowed': signed in, in a couple with both members (read from the
 *               server, never assumed), and this couple's setup finished on
 *               this phone,
 *  - 'denied':  one of those is definitely not true (signed out, unpaired,
 *               partner left, new pairing's setup unfinished),
 *  - 'unknown': the server couldn't be reached; skip this time, don't stop.
 *
 * Each feature then checks its OWN sharing switch and Android permission.
 */
export type SyncVerdict =
  | { kind: 'allowed'; userId: string; coupleId: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'unknown'; reason: string };

export async function checkSyncAllowed(): Promise<SyncVerdict> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { kind: 'denied', reason: 'signed out' };
  const member = await supabase.from('couple_members').select('couple_id').eq('user_id', userId).maybeSingle();
  if (member.error) return { kind: 'unknown', reason: 'pairing check failed (offline?)' };
  if (!member.data) return { kind: 'denied', reason: 'not paired' };
  const coupleId = member.data.couple_id as string;
  const members = await supabase.from('couple_members').select('user_id').eq('couple_id', coupleId);
  if (members.error) return { kind: 'unknown', reason: 'partner check failed (offline?)' };
  if ((members.data?.length ?? 0) < 2) return { kind: 'denied', reason: 'partner not in the couple' };
  if (!(await pairingSetupAllowsSync(userId, coupleId))) return { kind: 'denied', reason: "this pairing's setup is not finished on this phone" };
  return { kind: 'allowed', userId, coupleId };
}
