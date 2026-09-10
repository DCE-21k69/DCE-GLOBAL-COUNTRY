// ============================================================================
// @dce/api — MemoryStore: persistencia en memoria para desarrollo y tests.
// No sobrevive a un reinicio del proceso (para eso está PostgresStore).
// ============================================================================

import { hexKey, type CountryMeta, type Hex } from '@dce/shared';
import type { Store, StoredUser } from './types';

export class MemoryStore implements Store {
  private users = new Map<string, StoredUser>();
  private countries = new Map<string, CountryMeta>();
  private ownership = new Map<string, string>(); // "q,r" → countryId
  private inventories = new Map<string, Record<string, number>>();

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

  async listCountries(): Promise<CountryMeta[]> {
    return [...this.countries.values()];
  }

  async createCountry(country: CountryMeta, ownership: Hex[]): Promise<void> {
    this.countries.set(country.id, country);
    for (const h of ownership) this.ownership.set(hexKey(h), country.id);
  }

  async getOwnership(): Promise<Map<string, string>> {
    return new Map(this.ownership);
  }

  async getInventories(countryId: string): Promise<Record<string, number> | null> {
    const inv = this.inventories.get(countryId);
    return inv ? { ...inv } : null;
  }

  async saveInventories(countryId: string, inv: Record<string, number>): Promise<void> {
    this.inventories.set(countryId, { ...inv });
  }
}
