import { z } from 'zod';
import type { DeviceIdentity } from '../../application/ports/DeviceIdentity';
import type { SecureStore } from '../../application/ports/SecureStore';
import type { DeviceInfo } from '../../domain/entities/User';
import { newUuid } from '../../domain/valueObjects/Uuid';

const UUID_KEY = 'device.uuid';
const DEVICE_KEY = 'device.registered';

const deviceSchema = z.object({
  uuid: z.string(),
  code: z.string(),
  status: z.string(),
  name: z.string().optional(),
  storeUuid: z.string().optional(),
});

/** Device uuid generated once (CSPRNG) and stored in secure storage; survives logouts. */
export class SecureDeviceIdentity implements DeviceIdentity {
  private uuid: string | null = null;

  constructor(
    private readonly store: SecureStore,
    private readonly describeFn: () => Promise<{ model: string; platform: string }> = () =>
      Promise.resolve({ model: 'unknown', platform: 'web' }),
  ) {}

  async getDeviceUuid(): Promise<string> {
    if (this.uuid) return this.uuid;
    let id = await this.store.get(UUID_KEY);
    if (!id) {
      id = newUuid();
      await this.store.set(UUID_KEY, id);
    }
    this.uuid = id;
    return id;
  }

  async getRegisteredDevice(): Promise<DeviceInfo | null> {
    const raw = await this.store.get(DEVICE_KEY);
    if (!raw) return null;
    try {
      const v = deviceSchema.safeParse(JSON.parse(raw));
      return v.success ? v.data : null;
    } catch {
      return null;
    }
  }

  async saveRegisteredDevice(device: DeviceInfo): Promise<void> {
    await this.store.set(DEVICE_KEY, JSON.stringify(device));
  }

  describe(): Promise<{ model: string; platform: string }> {
    return this.describeFn();
  }
}
