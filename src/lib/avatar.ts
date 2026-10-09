import { colors } from './theme';
import type { Profile } from './types';

/**
 * ONE place that maps a profile's avatar colour to the actual Bond colours.
 *   blue  → #8DB4F0 (colors.me)
 *   pink  → #F5A3B7 (colors.partner)
 * No new colours are introduced; these are the existing palette values.
 */
export type AvatarColor = 'blue' | 'pink';

export const AVATAR_CHOICES: { key: AvatarColor; label: string; color: string }[] = [
  { key: 'blue', label: 'Blue', color: colors.me },
  { key: 'pink', label: 'Pink', color: colors.partner },
];

/** The circle colour for a chosen avatar colour (falls back to soft primary). */
export function avatarTint(color: AvatarColor | null | undefined): string {
  if (color === 'blue') return colors.me;
  if (color === 'pink') return colors.partner;
  return colors.primarySoft;
}

/** Convenience: the tint for a whole profile. */
export function tintForProfile(profile: Profile | null | undefined): string {
  return avatarTint(profile?.avatar_color ?? null);
}
