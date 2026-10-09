/**
 * PLACEHOLDER DATA for this UI phase.
 *
 * None of this is real device data. It exists only so the screens look
 * complete while we build the layout. Real values (screen time, battery,
 * location, protection) will replace these in later phases once the native
 * Android features are implemented.
 *
 * Every value here is clearly fake and labelled "Example" in the UI.
 */

export type MockPerson = {
  screenMinutes: number; // today's total, in minutes
  battery: number;
  charging: boolean;
  locationSharing: boolean;
  locationPlace: string;
  locationAgo: string;
  protection: string;
  protectionOn: boolean;
  lastActive: string;
};

export const MOCK_ME: MockPerson = {
  screenMinutes: 134, // 2h 14m
  battery: 91,
  charging: true,
  locationSharing: false,
  locationPlace: 'Not shared',
  locationAgo: '—',
  protection: 'No active protection',
  protectionOn: false,
  lastActive: 'now',
};

export const MOCK_PARTNER: MockPerson = {
  screenMinutes: 208, // 3h 28m
  battery: 78,
  charging: false,
  locationSharing: true,
  locationPlace: 'Quezon City',
  locationAgo: '2 min ago',
  protection: 'Adult Website Protection ON',
  protectionOn: true,
  lastActive: '1 min ago',
};

/** Example distance between the two of you, shown when both share location. */
export const MOCK_DISTANCE_KM = 1.2;

export type MockActivity = {
  id: string;
  icon: string; // Ionicons name
  tone: 'primary' | 'success' | 'blue' | 'neutral' | 'warning';
  title: string;
  time: string;
};

export const MOCK_ACTIVITY: MockActivity[] = [
  { id: '1', icon: 'heart', tone: 'primary', title: 'Partner joined your couple', time: 'Just now' },
  { id: '2', icon: 'location', tone: 'blue', title: 'Partner enabled location sharing', time: '2 min ago' },
  { id: '3', icon: 'shield-checkmark', tone: 'success', title: 'Adult Website Protection request accepted', time: '8 min ago' },
  { id: '4', icon: 'hourglass', tone: 'neutral', title: 'Screen time updated', time: '15 min ago' },
  { id: '5', icon: 'phone-portrait', tone: 'warning', title: 'App restriction requested', time: '1 h ago' },
];
