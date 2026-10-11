import { requireOptionalNativeModule } from 'expo';

/** Instant (synchronous) on-phone preferences. Null on builds without this module. */
type BondPrefsNative = {
  getTheme(): 'system' | 'light' | 'dark';
  setTheme(value: 'system' | 'light' | 'dark'): 'system' | 'light' | 'dark';
};

const BondPrefs = requireOptionalNativeModule<BondPrefsNative>('BondPrefs');

export default BondPrefs;
