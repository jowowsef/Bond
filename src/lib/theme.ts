// Bond's look: light, soft pastels, rounded, friendly.

export const colors = {
  background: '#F7F7FD',
  card: '#FFFFFF',
  text: '#1F1D36',
  subtext: '#6B6A80',
  muted: '#A3A2B5',
  border: '#ECEBF5',

  primary: '#8C7CF0',      // lavender
  primarySoft: '#EFECFF',
  blue: '#6FA3F2',         // soft blue
  blueSoft: '#E7F0FE',
  pink: '#F28DB6',         // light pink
  pinkSoft: '#FDEBF3',

  success: '#3FB984',
  successSoft: '#E4F7EE',
  warning: '#E8A13A',
  warningSoft: '#FDF3E2',
  danger: '#E5677A',
  dangerSoft: '#FDE9EC',
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const font = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.3 },
  h2: { fontSize: 19, fontWeight: '700' as const },
  h3: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  number: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
};

export const shadow = {
  shadowColor: '#5B4FD6',
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};
