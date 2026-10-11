import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';

/**
 * Drop-in replacement for expo-router's <Redirect>.
 *
 * expo-router's own <Redirect> calls router.replace() in a focus effect that
 * is recreated on EVERY render, so a focused screen that keeps re-rendering
 * (for example while the couple state updates several times during an
 * unpair) replaces the route again and again. Together with other screens
 * redirecting at the same moment this became an endless loop that React
 * stopped with "Maximum update depth exceeded", which closed Bond.
 *
 * This version redirects once each time the screen gains focus, or when the
 * target itself changes, never on ordinary re-renders.
 */
export function Redirect({ href }: { href: Href }) {
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  useFocusEffect(
    useCallback(() => {
      try {
        router.replace(href);
      } catch (error) {
        console.warn('[Bond] redirect failed', error);
      }
      // `key` stands for `href` (objects get a new identity each render).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );
  return null;
}
