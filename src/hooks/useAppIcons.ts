import { useEffect, useState } from 'react';
import BondUsage from '../../modules/bond-usage';

/**
 * Real launcher icons for app package names, from this phone (bond-usage).
 *
 * Each icon is looked up once per app session and remembered here (the
 * native side also keeps the PNG on disk), so lists and scrolling never ask
 * again. null = no icon available (not installed on this phone, no icon of
 * its own, or an older build), and the UI shows a neutral placeholder.
 */
const ICON_PX = 96; // drawn at 96px, shown at 28 to 36dp: sharp on dense screens
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<void>>();

function fetchMissing(packages: string[]): Promise<void> {
  const getIcons = BondUsage?.getAppIcons;
  const missing = packages.filter((p) => !cache.has(p) && !inflight.has(p));
  if (!getIcons || missing.length === 0) {
    return Promise.all(packages.map((p) => inflight.get(p)).filter(Boolean)).then(() => undefined);
  }
  const job = getIcons(missing, ICON_PX)
    .then((result) => {
      for (const p of missing) cache.set(p, result[p] ?? null);
    })
    .catch(() => {
      for (const p of missing) cache.set(p, null);
    })
    .finally(() => {
      for (const p of missing) inflight.delete(p);
    });
  for (const p of missing) inflight.set(p, job);
  return job;
}

export function useAppIcons(packages: string[]): Record<string, string | null> {
  const key = packages.join('|');
  const [, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const list = key ? key.split('|') : [];
    if (list.some((p) => !cache.has(p))) {
      void fetchMissing(list).then(() => {
        if (active) setVersion((v) => v + 1);
      });
    }
    return () => {
      active = false;
    };
  }, [key]);

  // Cheap lookups from the shared cache; re-rendered when a batch arrives.
  return Object.fromEntries(packages.map((p) => [p, cache.get(p) ?? null]));
}
