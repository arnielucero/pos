import { z } from 'zod';
import type { DeviceInfo } from '../../domain/entities/User';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import type { Clock } from '../ports/Clock';
import type { DeviceIdentity } from '../ports/DeviceIdentity';
import type { DeviceGateway } from '../ports/Gateways';
import type { Logger } from '../ports/Logger';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';

const schema = z.object({ deviceName: z.string().trim().min(3, 'Name is too short').max(100) });

/** Manager-only: registers this tablet with the store (POST /devices/register, idempotent). */
export class RegisterDeviceUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: {
      devices: DeviceGateway;
      deviceIdentity: DeviceIdentity;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(input: { deviceName: string }): Promise<DeviceInfo> {
    const { deviceName } = parseOrThrow(schema, input, 'Invalid device name');
    const d = this.deps;
    const user = d.session.requireUser();
    this.permissions.require(user, 'device.register');
    const deviceUuid = await d.deviceIdentity.getDeviceUuid();
    const device = await d.devices.register({ deviceUuid, deviceName, deviceType: 'ANDROID_TABLET' });
    await d.deviceIdentity.saveRegisteredDevice(device);
    await d.uow.run((r) =>
      r.audit.append(auditEvent('DEVICE_REGISTERED', d.clock.now(), user.uuid, { type: 'device', uuid: device.uuid }, { code: device.code })),
    );
    d.logger.audit('Device registered', { deviceCode: device.code });
    d.session.update({ device });
    return device;
  }
}
