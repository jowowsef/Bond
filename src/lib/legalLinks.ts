import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { LEGAL } from '@/content/legal';

export type LegalPage = 'privacy' | 'terms';

export const LEGAL_URLS: Record<LegalPage, string> = {
  privacy: LEGAL.privacyPolicyUrl,
  terms: LEGAL.termsUrl,
};

/**
 * Opens the official Privacy Policy / Terms of Use (docs/ on GitHub Pages) in
 * the phone's browser. If no browser can open it, shows the in-app summary
 * (/privacy or /terms) instead, so the link never does nothing.
 */
export async function openLegalPage(page: LegalPage): Promise<void> {
  try {
    await Linking.openURL(LEGAL_URLS[page]);
  } catch {
    router.push(page === 'privacy' ? '/privacy' : '/terms');
  }
}
