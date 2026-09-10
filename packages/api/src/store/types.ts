// ============================================================================
// @dce/api — Contrato de la capa de persistencia (v1.0).
//
// La simulación persiste por SNAPSHOT COMPLETO tras cada acción (escala
// perfecta para el Alpha y simplifica la consistencia). Usuarios aparte.
// Implementaciones: MemoryStore (dev/tests) y PostgresStore (DATABASE_URL).
// ============================================================================

import type { PersistedState } from '@dce/shared';

export interface StoredUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Store {
  // Usuarios (cuentas)
  createUser(user: StoredUser): Promise<void>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;

  // Estado del mundo (snapshot)
  loadState(): Promise<PersistedState | null>;
  saveState(state: PersistedState): Promise<void>;
}
