/**
 * RELEASE SHRINKING (config plugin, survives every `expo prebuild`)
 *
 * Turns on R8 (code shrinking/minification) and resource shrinking for
 * release builds only, through the properties the generated
 * android/app/build.gradle already reads:
 *   android.enableMinifyInReleaseBuilds=true
 *   android.enableShrinkResourcesInReleaseBuilds=true
 * Debug builds are unchanged. Libraries ship their own keep rules; Bond's own
 * modules keep what is looked up by name (modules/<name>/android/proguard-rules.pro).
 */
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
};

/** Pure transform (exported for tests). Idempotent. */
function applyShrinking(items) {
  const out = items.filter((i) => !(i.type === 'property' && i.key in PROPS));
  for (const [key, value] of Object.entries(PROPS)) out.push({ type: 'property', key, value });
  return out;
}

const withReleaseShrinking = (config) =>
  withGradleProperties(config, (c) => {
    c.modResults = applyShrinking(c.modResults);
    return c;
  });

module.exports = withReleaseShrinking;
module.exports.applyShrinking = applyShrinking;
