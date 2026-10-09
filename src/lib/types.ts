// TypeScript shapes of the rows in our Supabase tables (see supabase/schema.sql).

export type Mood = 'good' | 'okay' | 'not_great' | 'miss_you';

export type Profile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_color: 'blue' | 'pink' | null;
  mood: Mood | null;
  quick_status: string | null;
  mood_updated_at: string | null;
  created_at: string;
};

export type Couple = {
  id: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type CoupleMember = {
  couple_id: string;
  user_id: string;
  joined_at: string;
};

export type PrivacySettings = {
  user_id: string;
  share_location: boolean;
  share_screen_time: boolean;
  share_battery: boolean;
  share_activity: boolean;
  battery_alerts: boolean;
  updated_at: string;
};

export type Presence = { user_id: string; last_seen: string };

export type BatteryStatus = {
  user_id: string;
  level: number | null;
  is_charging: boolean;
  updated_at: string;
};

export type DevicePermissions = {
  user_id: string;
  notifications: boolean;
  location_foreground: boolean;
  location_background: boolean;
  usage_access: boolean;
  vpn_permission: boolean;
  website_protection_running: boolean;
  accessibility_enabled: boolean;
  battery_optimization_ignored: boolean;
  device_model: string | null;
  app_version: string | null;
  updated_at: string;
};

export type ScreenTimeDay = {
  user_id: string;
  day: string; // 'YYYY-MM-DD'
  total_ms: number;
  launches: number;
  updated_at: string;
};

export type AppUsageDay = {
  user_id: string;
  day: string;
  package_name: string;
  app_name: string;
  foreground_ms: number;
  launches: number;
  updated_at: string;
};

export type InstalledAppRow = {
  user_id: string;
  package_name: string;
  app_name: string;
};

export type LocationRow = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  place_name: string | null;
  is_background: boolean;
  updated_at: string;
};

export type ControlType = 'web_category' | 'web_domain' | 'web_allow' | 'app_block' | 'app_internet';

export type ControlRequest = {
  id: string;
  couple_id: string;
  requester_id: string;
  target_id: string;
  control_type: ControlType;
  value: string;
  label: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  created_at: string;
  responded_at: string | null;
};

export type ActiveControl = {
  id: string;
  couple_id: string;
  owner_id: string;
  control_type: ControlType;
  value: string;
  label: string;
  requested_by: string | null;
  approved_by: string | null;
  request_id: string | null;
  status: 'active' | 'revoked';
  enabled_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

export type ApprovalAction = 'unpair' | 'location_off';

export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired';

export type ApprovalRequest = {
  id: string;
  couple_id: string;
  requester_id: string;
  target_id: string;
  action: ApprovalAction;
  details: Record<string, unknown>;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
};

export type ActivityLog = {
  id: string;
  couple_id: string;
  actor_id: string | null;
  subject_id: string | null;
  kind: string;
  message: string;
  created_at: string;
};

/** Everything we know about ONE person's phone. */
export type PersonSnapshot = {
  profile: Profile | null;
  avatarUrl: string | null;
  privacy: PrivacySettings | null;
  presence: Presence | null;
  battery: BatteryStatus | null;
  permissions: DevicePermissions | null;
  location: LocationRow | null;
  screenToday: ScreenTimeDay | null;
};
