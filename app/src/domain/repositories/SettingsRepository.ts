import type { StoreSettings } from '../entities/Settings';

export interface SettingsRepository {
  getStoreSettings(): Promise<StoreSettings>;
  saveStoreSettings(settings: Partial<StoreSettings>): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
