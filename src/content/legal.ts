/**
 * In-app summaries of Bond's Privacy Policy and Terms of Use (shown at
 * /privacy and /terms when the official pages can't be opened). One place to
 * edit both.
 *
 * The OFFICIAL documents are docs/privacy-policy.html and docs/terms.html
 * (Termly), published on GitHub Pages at the URLs below; Settings and the
 * welcome screen open those. Keep these summaries consistent with them, and
 * update both whenever a feature changes what data Bond collects or shares.
 */

export const LEGAL = {
  operator: 'Josef John B. Casangcapan',
  contactEmail: 'bondsupport.app@gmail.com',
  address: 'Quezon City, Philippines',
  supabaseRegion: 'Singapore',
  privacyPolicyDate: 'October 13, 2026',
  termsDate: 'October 12, 2026',
  privacyPolicyUrl: 'https://jowowsef.github.io/Bond/privacy-policy.html',
  termsUrl: 'https://jowowsef.github.io/Bond/terms.html',
  minimumAge: 18,
};

export type LegalSection = { heading: string; body?: string[]; bullets?: string[] };
export type LegalDoc = {
  title: string;
  /** The official full document (opened by the button at the top). */
  page: 'privacy' | 'terms';
  intro: string;
  sections: LegalSection[];
};

const contact = `${LEGAL.operator}, ${LEGAL.contactEmail}, ${LEGAL.address}`;

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy Policy',
  page: 'privacy',
  intro:
    `This is a summary of Bond's Privacy Policy. The full Privacy Policy is at ${LEGAL.privacyPolicyUrl}; ` +
    `if this summary and the full policy differ, the full policy applies. ` +
    `Bond is a private app for two partners who choose to connect. Bond is operated by ${LEGAL.operator} ("we"). ` +
    `Last updated: ${LEGAL.privacyPolicyDate}.`,
  sections: [
    {
      heading: '1. The short version',
      bullets: [
        'Your partner only sees what you choose to share, and you can change each sharing switch in Settings.',
        'Bond has no ads, no analytics or tracking tools, and does not sell your information.',
        'Location is collected only while location sharing is on (while Bond is closed too, only if you choose "Allow all the time" in Android), and only your latest position is kept.',
        'You can delete your account in Settings at any time.',
      ],
    },
    {
      heading: '2. Information Bond processes',
      body: ['Depending on the features you use, Bond processes:'],
      bullets: [
        'Account: an account ID, your email address and password (the password is handled by our authentication provider and stored only in hashed form; Bond never sees or keeps it), or, if you continue with Google, your name, email address and Google profile picture link from Google.',
        'Profile: your display name, avatar colour and, if you add one, your profile photo.',
        'Pairing: your couple ID, the pairing code, who you are paired with, requests between you (for example to unpair), and an activity history of these events.',
        'Privacy settings: which kinds of information you share with your partner.',
        'Location (only while location sharing is on): your latest latitude and longitude, its accuracy, the time, and an approximate area name. If you also choose "Allow all the time" in Android, it is also shared while Bond is closed or your screen is locked, and Android shows a notification while this runs. Bond does not keep a location history. Your stored location is deleted when you turn sharing off or unpair.',
        'Battery (only while battery sharing is on): battery percentage, whether it is charging, and the time of the reading. While it is on, Bond runs a background service with a notification to send changes.',
        'Screen Time (only after you turn on Android "Usage access" for Bond): which apps were in use on your phone and for how long. Hourly details and app icons stay on your phone. If screen-time sharing is on, your daily total, app opens, and your top apps (name, package name, time used) are uploaded for your partner.',
        'Currently Using (only while it is on and Android "Usage access" is allowed): the name of the app open in front on your phone and when it was checked. Only the latest one is stored, never a history, and nothing inside apps (no messages, notifications, typed text or passwords). If you also turn on the optional Live Currently Using in Android’s Accessibility settings, Bond learns about app switches right away, but still only the app’s name; it cannot read your screen.',
        'Shared calendar: the events you or your partner create (title, date, times, place, notes, reminder and repeat settings) and who created them.',
        'Notifications: whether notifications are allowed, and, if push notifications are set up, a device push token.',
        'Alerts: low-battery alerts about your partner (their name and battery level), a notice when your partner unpairs, and reminders for shared calendar events.',
        'Technical logs: our hosting provider records technical information such as your IP address and the time of requests, to keep Bond working and secure.',
      ],
    },
    {
      heading: '3. What stays on your phone',
      bullets: [
        'Your sign-in session, a copy of your couple information (so Bond opens quickly), and your preferences such as the theme.',
        'Screen Time details beyond the shared daily summary, and app icons.',
        'Location troubleshooting details shown under "Location details".',
      ],
    },
    {
      heading: '4. Why we process it',
      bullets: [
        'To create and secure your account and connect you with your partner (needed to provide Bond).',
        'To show your partner the information you chose to share, and to show you theirs.',
        'To send you alerts and notifications you can control in Android settings.',
        'To keep Bond secure and working (for example preventing access by anyone outside your couple).',
        'Sensitive sharing (location, battery, screen time, Currently Using) happens only after you turn it on. You can withdraw that consent by turning the switch off.',
      ],
    },
    {
      heading: '5. What your partner can see',
      body: [
        'Your partner can always see your name, avatar, that you are paired, the shared activity history and the shared calendar. ' +
          'They can see your location, battery, screen time and the app you are using only while the matching switch is on in your Settings. ' +
          'Bond never lets your partner change permissions on your phone.',
      ],
    },
    {
      heading: '6. Service providers who process data for Bond',
      bullets: [
        `Supabase (database, sign-in, file storage, live updates and account emails). Your data is stored on Supabase servers in ${LEGAL.supabaseRegion}.`,
        "Your phone's location service (Google on most Android phones) receives your coordinates to look up an approximate area name.",
        'OpenFreeMap provides the map. It receives your IP address and which map area is shown.',
        'Expo and Google Firebase (only if push notifications are enabled) deliver notification text to your phone.',
        'These providers may process data outside the Philippines. We rely on their security and contractual commitments.',
      ],
    },
    {
      heading: '7. How long we keep information',
      bullets: [
        'Account, profile and settings: until you delete your account.',
        'Location: only the latest position, deleted when you turn location sharing off.',
        'Battery and Currently Using: only the latest reading, deleted when you turn that sharing off or unpair.',
        'Shared screen-time summaries: up to 30 days, and deleted when you unpair.',
        'Alerts and reminders: up to 30 days.',
        'Shared calendar events: until either of you deletes them, or until you unpair.',
        'Activity history and requests: until you unpair or delete your account.',
        'When you delete your account, your data is deleted.',
      ],
    },
    {
      heading: '8. Security',
      body: [
        'Bond uses encrypted connections (HTTPS), database rules that limit each record to you and your partner, private photo storage with links that expire after 24 hours, and passwords handled only by our authentication provider. ' +
          'No system is perfectly secure. If a breach affects your information, we will notify you and the authorities as the law requires.',
      ],
    },
    {
      heading: '9. Your choices and rights',
      bullets: [
        'Turn any sharing switch off in Settings, Privacy, or turn off the Android permission for Bond.',
        'Unpair from Settings. Delete your account in Settings, "Delete account".',
        'Under the Philippine Data Privacy Act you may ask to be informed, to access, correct, object to processing, block or erase your data, request a copy (data portability), and seek damages. Contact us to make a request.',
        'You can also complain to the National Privacy Commission (privacy.gov.ph).',
        'If other laws apply to you (for example in the EU), you may have similar rights.',
      ],
    },
    {
      heading: '10. Age',
      body: [`Bond is intended for people aged ${LEGAL.minimumAge} and over. Do not use Bond if you are younger.`],
    },
    {
      heading: '11. Changes to this policy',
      body: [
        'We will update the "Last updated" date at the top of the policy. If we make material changes, we may notify you by prominently posting a notice of the changes or by sending you a notification directly.',
      ],
    },
    {
      heading: '12. Contact',
      body: [
        `Privacy questions and requests: ${contact}. Data Protection Officer: ${LEGAL.operator}, ${LEGAL.contactEmail}.`,
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDoc = {
  title: 'Terms of Use',
  page: 'terms',
  intro:
    `This is a summary of Bond's Terms of Use. The full Terms of Use are at ${LEGAL.termsUrl}; ` +
    `if this summary and the full terms differ, the full terms apply. ` +
    `The terms are an agreement between you and ${LEGAL.operator} about using Bond. ` +
    `By using Bond you accept them. Last updated: ${LEGAL.termsDate}.`,
  sections: [
    {
      heading: '1. Who can use Bond',
      body: [
        `You must be at least ${LEGAL.minimumAge} and able to agree to these terms. Bond is for two adults who both choose to connect.`,
      ],
    },
    {
      heading: '2. Your account',
      bullets: [
        'You are responsible for activity on your account and for keeping your phone, password and Google account secure.',
        'Tell us if you think someone else has access to your account.',
      ],
    },
    {
      heading: '3. Consent between partners',
      bullets: [
        'Pairing, and every kind of sharing, must be freely chosen by the person whose information is shared.',
        "You must not pressure, threaten or trick anyone into pairing, sharing, or allowing permissions, and you must not use Bond on another person's phone without their knowledge.",
        'Each person controls their own phone. Bond cannot change permissions or settings on your partner\'s phone.',
      ],
    },
    {
      heading: '4. Acceptable use',
      body: ['You agree not to:'],
      bullets: [
        'use Bond to stalk, harass, monitor or control another person;',
        'try to access accounts, data or couples that are not yours;',
        'interfere with, reverse engineer, or overload Bond or its services, except where the law allows;',
        'use Bond for anything illegal.',
      ],
    },
    {
      heading: '5. Feature limits',
      bullets: [
        "Location, battery and screen time depend on your phone, its settings and Android. They can be delayed, approximate or unavailable, and must not be relied on for safety or emergencies.",
        'Background updates and notifications depend on Android and your network and can be delayed.',
        'Do not rely on Bond in an emergency. Contact local emergency services.',
      ],
    },
    {
      heading: '6. Availability and changes',
      body: [
        'We may update, change or pause Bond, for example for maintenance or security. We try to keep it available but do not promise uninterrupted service.',
      ],
    },
    {
      heading: '7. Unpairing, suspension and deletion',
      bullets: [
        'Unpairing ends sharing between you and removes your shared activity history.',
        'You can delete your account at any time in Settings.',
        'We may suspend or close accounts used against these terms or the law, especially to harm another person.',
      ],
    },
    {
      heading: '8. Ownership',
      body: [
        `Bond's app, design and name belong to ${LEGAL.operator}. You keep ownership of your content (such as your photo) and give us permission to store and show it to your partner only to run Bond. Open-source parts of Bond remain under their own licences.`,
      ],
    },
    {
      heading: '9. Disclaimers and liability',
      body: [
        'Bond is provided "as is" and "as available". To the extent the law allows, we do not give warranties beyond those you have under consumer law, and we are not liable for indirect losses or for the actions of your partner.',
        'To the extent the law allows, our liability to you for any cause will be limited to $100.00 USD. Some laws do not allow certain limitations; where they apply, some of these limits may not apply to you.',
        'Nothing in these Legal Terms limits any rights you have under applicable Philippine consumer protection law or other laws that cannot be excluded or limited by agreement.',
      ],
    },
    {
      heading: '10. Law and disputes',
      body: [
        'These terms are governed by the laws of the Philippines, and disputes are resolved in the courts of the Philippines. The full Terms of Use explain this in detail.',
      ],
    },
    {
      heading: '11. Changes to these terms',
      body: [
        'We will update the "Last updated" date at the top of the terms. If we make material changes, we will also notify users by email or through a notice in the app.',
      ],
    },
    {
      heading: '12. Contact',
      body: [`Questions about these terms: ${contact}.`],
    },
  ],
};
