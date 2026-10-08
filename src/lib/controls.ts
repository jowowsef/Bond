import type { ActiveControl, ControlRequest, ControlType } from './types';

/**
 * Everything the app can enforce, described HONESTLY.
 * These texts are shown in the request screen and the approval dialog,
 * so both people know exactly what will happen on the phone.
 */

export type WebCategory = {
  value: 'adult' | 'gambling' | 'malware' | 'phishing';
  label: string;
  emoji: string;
  description: string;
};

export const WEB_CATEGORIES: WebCategory[] = [
  {
    value: 'adult',
    label: 'Adult websites',
    emoji: '🔞',
    description:
      'Blocks websites categorised as adult content, using a community blocklist (~75,000 sites) plus Cloudflare Family DNS.',
  },
  {
    value: 'gambling',
    label: 'Gambling websites',
    emoji: '🎰',
    description: 'Blocks online casinos and betting sites using a community blocklist (~6,500 sites).',
  },
  {
    value: 'malware',
    label: 'Malware websites',
    emoji: '🦠',
    description: 'Blocks websites known to spread viruses or malware (Cloudflare security DNS).',
  },
  {
    value: 'phishing',
    label: 'Phishing / scam websites',
    emoji: '🎣',
    description: 'Blocks fake login pages and known scam websites (Cloudflare security DNS).',
  },
];

export const CONTROL_TYPE_INFO: Record<ControlType, { title: string; what: string }> = {
  web_category: {
    title: 'Website protection',
    what: 'Websites in this category will not open in any browser or app on the phone.',
  },
  web_domain: {
    title: 'Blocked website',
    what: 'This website (and its sub-sites, e.g. www. / m.) will not open on the phone.',
  },
  web_allow: {
    title: 'Always-allowed website',
    what: 'This website is never blocked by website protection.',
  },
  app_block: {
    title: 'App blocked',
    what:
      'When the app is opened, Bond sends you back to the home screen and shows a "paused" screen. Needs Bond\'s Accessibility setting turned on.',
  },
  app_internet: {
    title: 'App internet restricted (best effort)',
    what:
      'The app\'s new internet lookups are refused, so most online features stop working. Already-open connections and some apps may still get through. Requires Android 10+.',
  },
};

export function controlEmoji(type: ControlType, value?: string): string {
  if (type === 'web_category') return WEB_CATEGORIES.find((c) => c.value === value)?.emoji ?? '🛡️';
  if (type === 'web_domain') return '🌐';
  if (type === 'web_allow') return '✅';
  if (type === 'app_block') return '⛔';
  return '📵';
}

/** Short sentence for the approval dialog. */
export function describeRequest(r: Pick<ControlRequest, 'control_type' | 'label' | 'value'>): string {
  switch (r.control_type) {
    case 'web_category':
      return WEB_CATEGORIES.find((c) => c.value === r.value)?.description ?? CONTROL_TYPE_INFO.web_category.what;
    case 'web_domain':
      return `${r.value} (and its sub-sites) will not open on your phone.`;
    case 'app_block':
      return `${r.label} will be paused: opening it sends you back to the home screen. You can turn this off anytime.`;
    case 'app_internet':
      return `${r.label} will mostly lose internet access (best effort — existing connections may continue).`;
    default:
      return CONTROL_TYPE_INFO[r.control_type].what;
  }
}

export function requestTitle(r: Pick<ControlRequest, 'control_type' | 'label'>): string {
  switch (r.control_type) {
    case 'web_category':
      return `${r.label} protection`;
    case 'web_domain':
      return `Block ${r.label}`;
    case 'app_block':
      return `Block ${r.label}`;
    case 'app_internet':
      return `Restrict ${r.label} internet`;
    default:
      return r.label;
  }
}

export const isWebControl = (t: ControlType) => t === 'web_category' || t === 'web_domain' || t === 'app_internet';

/** One-line summary for cards, e.g. "Adult websites, TikTok blocked" */
export function summarizeControls(controls: ActiveControl[]): string {
  const active = controls.filter((c) => c.status === 'active' && c.control_type !== 'web_allow');
  if (active.length === 0) return 'No controls';
  const names = active.slice(0, 2).map((c) => c.label);
  const rest = active.length - names.length;
  return names.join(', ') + (rest > 0 ? ` +${rest}` : '');
}

/** Basic check that a typed website looks like a domain. */
export function cleanDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/^\*\./, '').replace(/^www\./, '');
  d = d.replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}
