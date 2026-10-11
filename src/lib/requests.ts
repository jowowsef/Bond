import { supabase } from './supabase';
import type { ApprovalAction, ApprovalRequest } from './types';

/**
 * MUTUAL APPROVAL REQUESTS (client side)
 *
 * Thin wrappers over the Supabase RPCs in migrations/0001_approval_requests.sql.
 * A sensitive shared action (unpair, turning off your own location sharing)
 * is never applied directly — one partner requests it, the other approves,
 * and only then does the server change the shared state.
 */

export type RequestResult = { ok: true; id?: string } | { ok: false; message: string };

function friendly(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('network') || m.includes('fetch')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  if (m.includes('could not find the function') || m.includes('does not exist') || m.includes('schema cache')) {
    return 'The approval system isn\'t set up on the server yet. Run migrations/0001_approval_requests.sql in Supabase.';
  }
  if (m.includes('already have a pending')) return 'You already have a pending request for this.';
  if (m.includes('already off')) return 'Your location sharing is already off.';
  if (m.includes('expired')) return 'This request has expired. Ask your partner to send it again.';
  if (m.includes('only your partner')) return 'Only your partner can answer this request.';
  return raw;
}

/** Ask your partner to approve a sensitive action. */
export async function requestApproval(
  action: ApprovalAction,
  details: Record<string, unknown> = {},
): Promise<RequestResult> {
  const { data, error } = await supabase.rpc('create_approval_request', { p_action: action, p_details: details });
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, id: (data as string) ?? undefined };
}

/** Approve or decline a request where you are the target. */
export async function respondToApproval(requestId: string, accept: boolean): Promise<RequestResult> {
  const { error } = await supabase.rpc('respond_to_approval', { p_request_id: requestId, p_accept: accept });
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true };
}

/** Withdraw a pending request you created. */
export async function cancelApproval(requestId: string): Promise<RequestResult> {
  const { error } = await supabase.rpc('cancel_approval', { p_request_id: requestId });
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true };
}

/**
 * Load pending requests for the couple. Loaded SEPARATELY from the pairing
 * snapshot and fails soft (returns []), so a missing table or a dropped
 * request never affects pairing restore.
 */
export async function fetchPendingApprovals(): Promise<ApprovalRequest[]> {
  try {
    const { data, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data as ApprovalRequest[]) ?? [];
  } catch {
    return [];
  }
}

/** Human-readable titles used in the request cards. */
export function approvalTitle(action: ApprovalAction): string {
  switch (action) {
    case 'unpair':
      return 'Unpair request';
    case 'location_off':
      return 'Turn off location sharing';
    default:
      return 'Request';
  }
}

export function approvalDescription(action: ApprovalAction, requesterName: string): string {
  switch (action) {
    case 'unpair':
      return `${requesterName} wants to unpair. If you approve, you'll both be disconnected and any controls will be turned off.`;
    case 'location_off':
      return `${requesterName} wants to stop sharing their location with you.`;
    default:
      return `${requesterName} sent a request.`;
  }
}

/**
 * Location sharing is now each person's own switch (no approval). Withdraw
 * any "turn off location" request I sent under the old flow, so my partner
 * approving it later can never switch my sharing off unexpectedly.
 * Returns false only if a request could not be withdrawn.
 */
export async function withdrawMyLocationOffRequests(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('approval_requests')
    .select('id')
    .eq('requester_id', userId)
    .eq('action', 'location_off')
    .eq('status', 'pending');
  if (error) return false;
  let ok = true;
  for (const row of (data as { id: string }[]) ?? []) {
    const r = await cancelApproval(row.id);
    if (!r.ok) ok = false;
  }
  return ok;
}
