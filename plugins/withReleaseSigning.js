/**
 * RELEASE SIGNING (config plugin, survives every `expo prebuild`)
 *
 * Release builds are signed with Bond's own private key (bond-release.jks),
 * never with the public debug key the template uses. The keystore and its
 * password stay OUTSIDE this repository: Gradle reads them from the Windows
 * user's Gradle properties (%USERPROFILE%\.gradle\gradle.properties):
 *
 *   BOND_RELEASE_STORE_FILE=C:/Users/<you>/.bond-signing/bond-release.jks
 *   BOND_RELEASE_STORE_PASSWORD=...
 *   BOND_RELEASE_KEY_ALIAS=bond-release
 *   BOND_RELEASE_KEY_PASSWORD=...
 *
 * If any of them is missing (or the file doesn't exist), every release
 * build/bundle/install task STOPS with a clear message, so a release can never
 * fall back to the debug key. Debug builds are unchanged.
 *
 * If the generated build.gradle doesn't look as expected (a new template),
 * prebuild stops instead of guessing.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// @generated bond-release-signing';

const HEADER = `${MARK}
// Bond release signing: values come from the user's Gradle properties
// (outside the repository), never from this file.
def bondReleaseProps = ['BOND_RELEASE_STORE_FILE', 'BOND_RELEASE_STORE_PASSWORD', 'BOND_RELEASE_KEY_ALIAS', 'BOND_RELEASE_KEY_PASSWORD']
def bondReleaseSigningReady = bondReleaseProps.every { (findProperty(it) ?: '').toString().trim() } &&
    file(findProperty('BOND_RELEASE_STORE_FILE').toString()).exists()
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { t -> t.project == project && t.name ==~ /(assemble|bundle|package|install|sign)[A-Za-z]*Release[A-Za-z]*/ }
    if (wantsRelease && !bondReleaseSigningReady) {
        throw new GradleException('Bond release signing is not set up: add BOND_RELEASE_STORE_FILE, BOND_RELEASE_STORE_PASSWORD, ' +
            'BOND_RELEASE_KEY_ALIAS and BOND_RELEASE_KEY_PASSWORD to %USERPROFILE%\\\\.gradle\\\\gradle.properties ' +
            '(the keystore file must exist). Release builds are never signed with the debug key.')
    }
}
// end bond-release-signing
`;

const RELEASE_CONFIG = `        release {
            // ${MARK.slice(3)}
            if (bondReleaseSigningReady) {
                storeFile file(findProperty('BOND_RELEASE_STORE_FILE').toString())
                storePassword findProperty('BOND_RELEASE_STORE_PASSWORD').toString()
                keyAlias findProperty('BOND_RELEASE_KEY_ALIAS').toString()
                keyPassword findProperty('BOND_RELEASE_KEY_PASSWORD').toString()
                storeType 'pkcs12'
            }
        }
`;

/** Index of the "}" that closes the block whose "{" is at openIndex. */
function closingBrace(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Pure transform (exported for tests). Idempotent. */
function applyReleaseSigning(src) {
  if (src.includes(MARK)) return src;

  // 1. Helper values + the guard, before the android { } block.
  const androidAt = src.search(/^android\s*\{/m);
  if (androidAt < 0) throw new Error('[withReleaseSigning] "android {" not found in app/build.gradle');
  let out = src.slice(0, androidAt) + HEADER + '\n' + src.slice(androidAt);

  // 2. A "release" signing config inside signingConfigs { }.
  const sc = out.search(/signingConfigs\s*\{/);
  if (sc < 0) throw new Error('[withReleaseSigning] "signingConfigs {" not found');
  const scOpen = out.indexOf('{', sc);
  const scClose = closingBrace(out, scOpen);
  if (scClose < 0) throw new Error('[withReleaseSigning] signingConfigs block not closed');
  if (/^\s*release\s*\{/m.test(out.slice(scOpen + 1, scClose))) {
    throw new Error('[withReleaseSigning] signingConfigs already has a "release" config; refusing to guess');
  }
  const lineStart = out.lastIndexOf('\n', scClose) + 1; // the line with signingConfigs' closing "}"
  out = out.slice(0, lineStart) + RELEASE_CONFIG + out.slice(lineStart);

  // 3. buildTypes.release uses it (instead of the debug key).
  const bt = out.search(/buildTypes\s*\{/);
  if (bt < 0) throw new Error('[withReleaseSigning] "buildTypes {" not found');
  const btOpen = out.indexOf('{', bt);
  const btClose = closingBrace(out, btOpen);
  const rel = out.slice(btOpen, btClose).search(/\brelease\s*\{/);
  if (rel < 0) throw new Error('[withReleaseSigning] buildTypes.release not found');
  const relOpen = out.indexOf('{', btOpen + rel);
  const relClose = closingBrace(out, relOpen);
  const body = out.slice(relOpen, relClose);
  const count = (body.match(/signingConfig\s+signingConfigs\.\w+/g) ?? []).length;
  if (count !== 1) throw new Error(`[withReleaseSigning] expected one signingConfig in buildTypes.release, found ${count}`);
  const newBody = body.replace(/signingConfig\s+signingConfigs\.\w+/, 'signingConfig signingConfigs.release // Bond private key (see top of file)');
  out = out.slice(0, relOpen) + newBody + out.slice(relClose);
  return out;
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('[withReleaseSigning] only the Groovy app/build.gradle is supported');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
