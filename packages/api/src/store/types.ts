// ============================================================================
// @dce/api — Contrato de la capa de persistencia.
// Implementaciones: MemoryStore (dev/preview/tests) y PostgresStore (producción
// vía DATABASE_URL). La simulación nunca habla con la base de datos
// directamente: solo a través de esta interfaz (docs/01 §2).
// ============================================================================

import type { CountryMeta, Hex } from '@dce/shared';

export interface StoredUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Store {
  createUser(user: StoredUser): Promise<void>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;

  listCountries(): Promise<CountryMeta[]>;
  createCountry(country: CountryMeta, ownership: Hex[]): Promise<void>;
  /** Propiedad persistida: clave "q,r" → countryId (solo países de jugadores). */
  getOwnership(): Promise<Map<string, string>>;

  getInventories(countryId: string): Promise<Record<string, number> | null>;
  saveInventories(countryId: string, inv: Record<string, number>): Promise<void>;
}
