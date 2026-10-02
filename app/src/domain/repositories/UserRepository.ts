import type { StoreRef, UserProfile } from '../entities/User';

export interface UserRepository {
  upsert(user: UserProfile): Promise<void>;
  findByUuid(uuid: string): Promise<UserProfile | null>;
  upsertStore(store: StoreRef): Promise<void>;
}
