// ============================================================================
// @dce/api — PostgresStore: persistencia real en PostgreSQL (sql/schema.sql).
// Se activa definiendo DATABASE_URL. Requiere haber aplicado:
//   psql dce_global_country -f sql/schema.sql -f sql/seed.sql
// ============================================================================

import pg from 'pg';
import { hexKey, type CountryMeta, type Constitution, type Hex } from '@dce/shared';
import type { Store, StoredUser } from './types';

const { Pool } = pg;

/** El Alpha corre un único mundo (id=1, sembrado en sql/seed.sql). */
const WORLD_ID = 1;

interface CountryRow {
  id: string;
  name: string;
  color: string;
  founded_by: string | null;
  population: number;
  cap_q: number;
  cap_r: number;
  created_at: Date;
  government: string;
  economy: string;
  military: string;
  migration: string;
}

export class PostgresStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async createUser(user: StoredUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [user.id, user.username, user.email, user.passwordHash],
    );
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    return this.mapUser(
      await this.pool.query(
        `SELECT id, username, email, password_hash, created_at
         FROM users WHERE username = $1`,
        [username],
      ),
    );
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    return this.mapUser(
      await this.pool.query(
        `SELECT id, username, email, password_hash, created_at
         FROM users WHERE id = $1`,
        [id],
      ),
    );
  }

  private mapUser(result: pg.QueryResult<any>): StoredUser | null {
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listCountries(): Promise<CountryMeta[]> {
    const result = await this.pool.query<CountryRow>(
      `SELECT c.id, c.name, c.color, c.founded_by, c.population,
              c.cap_q, c.cap_r, c.created_at,
              co.government, co.economy, co.military, co.migration
       FROM countries c
       LEFT JOIN constitutions co ON co.country_id = c.id
       ORDER BY c.created_at`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      foundedBy: r.founded_by,
      capital: { q: r.cap_q, r: r.cap_r },
      constitution: {
        government: r.government,
        economy: r.economy,
        militaryDoctrine: r.military,
        migrationPolicy: r.migration,
      } as Constitution,
      population: r.population,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async createCountry(country: CountryMeta, ownership: Hex[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO countries (id, world_id, name, color, founded_by, population, cap_q, cap_r)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [country.id, WORLD_ID, country.name, country.color, country.foundedBy, country.population, country.capital.q, country.capital.r],
      );
      await client.query(
        `INSERT INTO constitutions (country_id, government, economy, military, migration)
         VALUES ($1, $2, $3, $4, $5)`,
        [country.id, country.constitution.government, country.constitution.economy, country.constitution.militaryDoctrine, country.constitution.migrationPolicy],
      );
      for (const h of ownership) {
        await client.query(
          `INSERT INTO country_hexes (world_id, q, r, country_id, is_capital)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (world_id, q, r)
           DO UPDATE SET country_id = EXCLUDED.country_id, is_capital = EXCLUDED.is_capital`,
          [WORLD_ID, h.q, h.r, country.id, h.q === country.capital.q && h.r === country.capital.r],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getOwnership(): Promise<Map<string, string>> {
    const result = await this.pool.query<{ q: number; r: number; country_id: string }>(
      `SELECT q, r, country_id FROM country_hexes WHERE world_id = $1`,
      [WORLD_ID],
    );
    const map = new Map<string, string>();
    for (const row of result.rows) map.set(`${row.q},${row.r}`, row.country_id);
    return map;
  }

  async getInventories(countryId: string): Promise<Record<string, number> | null> {
    const result = await this.pool.query<{ resource: string; quantity: number }>(
      `SELECT resource, quantity FROM inventories WHERE country_id = $1`,
      [countryId],
    );
    if (result.rows.length === 0) return null;
    const inv: Record<string, number> = {};
    for (const row of result.rows) inv[row.resource] = Number(row.quantity);
    return inv;
  }

  async saveInventories(countryId: string, inv: Record<string, number>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [resource, quantity] of Object.entries(inv)) {
        await client.query(
          `INSERT INTO inventories (country_id, resource, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (country_id, resource)
           DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
          [countryId, resource, quantity],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
