import { requireOptionalNativeModule } from 'expo';

/**
 * Bond Web Protection native module (Android only).
 * Optional so an older installed build shows "Needs the latest Bond" instead
 * of crashing or showing a switch that does nothing.
 */
export type WebStatus = {
  enabled: boolean;
  running: boolean;
  permissionGranted: boolean;
  otherVpnActive: boolean;
  privateDnsHost: string | null;
  stopReason: 'permission' | 'failed' | 'revoked' | null;
  listDomains: number;
  listUpdatedAt: number;
};

type BondWebNative = {
  getStatus(): WebStatus;
  requestPermission(): Promise<boolean>;
  enable(): boolean;
  disable(): boolean;
  openVpnSettings(): void;
  openNetworkSettings(): void;
};

const BondWeb = requireOptionalNativeModule<BondWebNative>('BondWeb');

export default BondWeb;
