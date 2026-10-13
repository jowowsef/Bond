# Bond

Bond is a private Android app for couples. Two people pair their accounts with an invite code, and each partner chooses what to share with the other. Every kind of sharing is off until you turn it on, and you can turn it off at any time.

## Features

- **Pairing** with a one-time invite code (expires after 24 hours). Unpairing needs both partners to agree, and it stops all sharing.
- **Location sharing**: your partner sees your latest location on a map. With Android's "Allow all the time", it keeps updating while Bond is closed. Only the latest position is stored.
- **Battery sharing**: battery level and charging status, with low-battery alerts for your partner.
- **Screen Time**: daily screen time and top apps, using Android's Usage access. Hourly details and app icons stay on your phone.
- **Currently Using**: the name of the app open on your phone (never anything inside apps). Optional **Live mode** (Android Accessibility, off by default) shows app switches within a second or two; it only reads the app's name, never the screen.
- **Shared calendar**: events with reminders and repeat options.
- **Requests between partners**, for example to unpair or to turn off location sharing.
- **Accounts** with email and password or Google Sign-In. You can delete your account from Settings.

Bond is intended for adults (18+) and only for consensual use between partners.

## Requirements

- Android 7.0 (API 24) or newer
- Internet connection
- Optional Android permissions, requested only when you turn on a feature: location (including "Allow all the time" for background updates), notifications, and Usage access for Screen Time and Currently Using

## Privacy Policy and Terms of Use

- [Privacy Policy](https://jowowsef.github.io/Bond/privacy-policy.html)
- [Terms of Use](https://jowowsef.github.io/Bond/terms.html)

## Development

Bond is built with [Expo](https://expo.dev) (SDK 57), React Native, TypeScript and [Supabase](https://supabase.com). It includes local native modules (`modules/`), so it runs in a development build, not in Expo Go.

### Setup

1. Install [Node.js](https://nodejs.org) (LTS) and the Android SDK (via Android Studio).
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and fill in your own values:
   - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from your Supabase project (Project Settings > API). Use the public anon/publishable key only, never the service role key.
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (optional): the Google Cloud "Web" OAuth client ID. Leave it empty to disable Google Sign-In.
4. Set up the database in your Supabase project by running `supabase/migrations/` in order.
5. Build and run on a connected Android device or emulator:

   ```bash
   npx expo run:android
   ```

### Checks

```bash
npm run typecheck
npm run lint
```

### Project structure

| Path | Contents |
| --- | --- |
| `src/app/` | Screens (Expo Router) |
| `src/components/`, `src/lib/`, `src/state/` | UI components, app logic, state |
| `modules/` | Local native Android modules (usage stats, preferences) |
| `plugins/` | Expo config plugins |
| `supabase/` | Database migrations and Edge Functions |
| `docs/` | Privacy Policy, Terms of Use and the email confirmation page (GitHub Pages) |

Release builds are signed with a private key that is not part of this repository.

## License

Copyright (c) Josef John B. Casangcapan. All rights reserved. See [LICENSE](LICENSE).
