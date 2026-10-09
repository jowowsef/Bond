import React from 'react';
import { Avatar } from './Avatar';
import { tintForProfile } from '@/lib/avatar';
import type { Profile } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * The ONE avatar used everywhere. Given a profile it shows, in a fixed-size
 * circular frame:
 *   - the person's photo if they have one (signed URL from context), else
 *   - their chosen Blue/Pink colour with initials.
 * This keeps display name, avatar colour, and photo consistent app-wide.
 */
export function ProfileAvatar({
  profile,
  who,
  size = 56,
  ring,
}: {
  profile: Profile | null | undefined;
  /** Whose avatar this is, so we can pick the right signed URL from context. */
  who: 'me' | 'partner';
  size?: number;
  ring?: string;
}) {
  const { myAvatarUrl, partnerAvatarUrl } = useCouple();
  const url = profile?.avatar_path ? (who === 'me' ? myAvatarUrl : partnerAvatarUrl) : null;
  return <Avatar name={profile?.display_name} url={url} tint={tintForProfile(profile)} size={size} ring={ring} />;
}
