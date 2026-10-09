// Bond's look: "Sky & Blush" — soft, clean, light.
// Sky blue = you, blush pink = your partner, a deeper blue for actions.

export const colors = {
  background: '#F7F9FC',
  card: '#FFFFFF',
  text: '#1F2A44',
  subtext: '#6B7590',
  muted: '#9AA3B8',
  border: '#E6EAF2',
  track: '#EEF2F8',        // empty part of progress bars, map blocks

  primary: '#3D6FD1',      // buttons, active tab, links
  primarySoft: '#E8EFFB',

  me: '#8DB4F0',           // sky blue — "You"
  meSoft: '#EAF1FD',
  partner: '#F5A3B7',      // blush pink — your partner
  partnerSoft: '#FDEEF2',

  // Readable blue for text/icons on light backgrounds (badges, accents).
  blue: '#3D6FD1',
  blueSoft: '#E8EFFB',
  pink: '#D9637F',
  pinkSoft: '#FDEEF2',

  success: '#1F8A5B',
  successSoft: '#E3F5EC',
  warning: '#B7791F',
  warningSoft: '#FCF3E3',
  danger: '#D2475F',
  dangerSoft: '#FCE9EC',
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 26, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/**
 * Inter is embedded in the Android build by the expo-font plugin (see
 * app.json) as ONE family with weights 400–800, so `fontWeight` picks the
 * right file automatically. Inter is the closest free match to Apple's
 * San Francisco font (which can't be shipped in Android apps).
 */
export const fontFamily = 'Inter';

export const font = {
  hero: { fontFamily, fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontFamily, fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.6 },
  h2: { fontFamily, fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontFamily, fontSize: 16, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontFamily, fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.1 },
  small: { fontFamily, fontSize: 13, fontWeight: '500' as const },
  tiny: { fontFamily, fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  number: { fontFamily, fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6 },
};

export const shadow = {
  shadowColor: '#1F2A44',
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
};
