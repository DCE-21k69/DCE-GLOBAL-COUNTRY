// ============================================================================
// @dce/api — MemoryStore: persistencia en memoria para desarrollo y tests.
// ============================================================================

import type { PersistedState } from '@dce/shared';
import type { Store, StoredUser } from './types';

export class MemoryStore implements Store {
  private users = new Map<string, StoredUser>();
  private state: PersistedState | null = null;

  async createUser(user: StoredUser): Promise<void> {
    this.users.set(user.id, user);
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const key = username.toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === key) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    return this.users.get(id) ?? null;
  }

  async loadState(): Promise<PersistedState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async saveState(state: PersistedState): Promise<void> {
    this.state = structuredClone(state);
  }
}
