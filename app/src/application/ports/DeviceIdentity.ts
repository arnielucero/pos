import type { DeviceInfo } from '../../domain/entities/User';

export interface DeviceIdentity {
  /** Stable device uuid, generated once and kept in secure storage. */
  getDeviceUuid(): Promise<string>;
  getRegisteredDevice(): Promise<DeviceInfo | null>;
  saveRegisteredDevice(device: DeviceInfo): Promise<void>;
  describe(): Promise<{ model: string; platform: string }>;
}
