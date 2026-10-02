import type { RegisterSession } from '../entities/Register';

export interface RegisterCloseData {
  readonly closedAt: string;
  readonly closedByUuid: string;
  readonly actualCash: number;
  readonly expectedCash: number;
  readonly cashSales: number;
  readonly cashRefunds: number;
  readonly cashAdjustments: number;
  readonly variance: number;
}

export interface RegisterSessionRepository {
  findOpen(deviceUuid: string): Promise<RegisterSession | null>;
  findByUuid(uuid: string): Promise<RegisterSession | null>;
  insert(session: RegisterSession): Promise<void>;
  close(uuid: string, data: RegisterCloseData): Promise<void>;
}
