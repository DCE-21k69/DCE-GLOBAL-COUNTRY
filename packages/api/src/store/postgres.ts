// ============================================================================
// @dce/api — PostgresStore: persistencia real en PostgreSQL (sql/schema.sql).
// Se activa con DATABASE_URL. Persiste el snapshot completo del motor en una
// transacción por acción. (Sin PostgreSQL en el sandbox: probado en CI/prod.)
// ============================================================================

import pg from 'pg';
import type { PersistedState } from '@dce/shared';
import type { Store, StoredUser } from './types';

const { Pool } = pg;

export class PostgresStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  // ── Usuarios ─────────────────────────────────────────────────────────────

  async createUser(user: StoredUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4)`,
      [user.id, user.username, user.email, user.passwordHash],
    );
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    return this.mapUser(
      await this.pool.query(
        `SELECT id, username, email, password_hash, created_at FROM users WHERE username = $1`,
        [username],
      ),
    );
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    return this.mapUser(
      await this.pool.query(
        `SELECT id, username, email, password_hash, created_at FROM users WHERE id = $1`,
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

  // ── Snapshot del mundo ───────────────────────────────────────────────────

  async loadState(): Promise<PersistedState | null> {
    const [countries, ownership, inventories, buildings, citizenships, armies, treaties, wars, proposals, missions] =
      await Promise.all([
        this.pool.query(`SELECT * FROM countries ORDER BY founded_at`),
        this.pool.query(`SELECT q, r, country_id FROM country_hexes`),
        this.pool.query(`SELECT country_id, resource, quantity FROM inventories`),
        this.pool.query(`SELECT * FROM buildings`),
        this.pool.query(`SELECT * FROM citizenships`),
        this.pool.query(`SELECT * FROM armies`),
        this.pool.query(`SELECT * FROM treaties`),
        this.pool.query(`SELECT * FROM wars`),
        this.pool.query(`SELECT * FROM assembly_proposals`),
        this.pool.query(`SELECT * FROM espionage_missions`),
      ]);

    if (countries.rows.length === 0) return null;

    this.buildInvCache(inventories.rows);

    return {
      countries: countries.rows.map((r) => ({
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
        },
        population: r.population,
        createdAt: r.founded_at.toISOString(),
        wikiHistory: r.wiki_history ?? '',
        wikiMotto: r.wiki_motto ?? '',
        flagSvg: r.flag_svg ?? '',
        happiness: r.happiness ?? 60,
        salary: r.salary ?? 5,
        currencyCode: r.currency_code ?? '',
        gdp: Number(r.gdp ?? 0),
        rebellionStrength: Number(r.rebellion_strength ?? 0),
        isPariah: r.is_pariah,
        isPuppetOf: r.is_puppet_of,
        npc: false,
      })),
      ownership: Object.fromEntries(ownership.rows.map((r) => [`${r.q},${r.r}`, r.country_id])),
      inventories: Object.fromEntries(
        inventories.rows.map((r) => [r.country_id, { ...(this.invCache.get(r.country_id) ?? {}) }]),
      ),
      buildings: buildings.rows.map((r) => ({
        id: r.id, countryId: r.country_id, hex: { q: r.q, r: r.r },
        type: r.type, tier: r.tier, level: r.level, workers: r.workers,
      })),
      citizenships: citizenships.rows.map((r) => ({
        userId: r.user_id, username: r.username, countryId: r.country_id,
        role: r.role, assignedBuildingId: r.assigned_building_id, joinedAt: r.joined_at.toISOString(),
      })),
      armies: armies.rows.map((r) => ({
        id: r.id, countryId: r.country_id, unitType: r.unit_type, soldiers: r.soldiers,
        hex: { q: r.q, r: r.r }, supply: r.supply, lastMovedTick: r.last_moved_tick,
      })),
      treaties: treaties.rows.map((r) => ({
        id: r.id, a: r.a, b: r.b, kind: r.kind, createdAt: r.created_at.toISOString(),
      })),
      wars: wars.rows.map((r) => ({
        id: r.id, aggressorId: r.aggressor_id, defenderId: r.defender_id, status: r.status,
        capturedHexes: r.captured_hexes ?? [], winnerId: r.winner_id,
        startedAt: r.started_at.toISOString(), endedAt: r.ended_at ? r.ended_at.toISOString() : null,
      })),
      proposals: proposals.rows.map((r) => ({
        id: r.id, proposerId: r.proposer_id, kind: r.kind, targetCountryId: r.target_country_id,
        taxPercent: r.tax_percent, votes: r.votes ?? {}, status: r.status, closesAt: Number(r.closes_at),
      })),
      missions: missions.rows.map((r) => ({
        id: r.id, spyCountryId: r.spy_country_id, targetCountryId: r.target_country_id,
        kind: r.kind, status: r.status, result: r.result, createdAt: r.created_at.toISOString(),
      })),
    };
  }

  // La lectura de inventarios por país se agrupa tras el snapshot.
  private invCache = new Map<string, Record<string, number>>();
  private buildInvCache(rows: any[]): void {
    this.invCache.clear();
    for (const r of rows) {
      const inv = this.invCache.get(r.country_id) ?? {};
      inv[r.resource] = Number(r.quantity);
      this.invCache.set(r.country_id, inv);
    }
  }

  async saveState(s: PersistedState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const c of s.countries) {
        await client.query(
          `INSERT INTO countries (id, world_id, name, color, flag_svg, population, cap_q, cap_r,
             founded_by, is_pariah, is_puppet_of, salary, happiness, rebellion_strength,
             currency_code, gdp, wiki_history, wiki_motto)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, color=EXCLUDED.color, flag_svg=EXCLUDED.flag_svg,
             population=EXCLUDED.population, cap_q=EXCLUDED.cap_q, cap_r=EXCLUDED.cap_r,
             founded_by=EXCLUDED.founded_by, is_pariah=EXCLUDED.is_pariah,
             is_puppet_of=EXCLUDED.is_puppet_of, salary=EXCLUDED.salary,
             happiness=EXCLUDED.happiness, rebellion_strength=EXCLUDED.rebellion_strength,
             currency_code=EXCLUDED.currency_code, gdp=EXCLUDED.gdp,
             wiki_history=EXCLUDED.wiki_history, wiki_motto=EXCLUDED.wiki_motto`,
          [c.id, 1, c.name, c.color, c.flagSvg, c.population, c.capital.q, c.capital.r,
            c.foundedBy, c.isPariah, c.isPuppetOf, c.salary, c.happiness, c.rebellionStrength,
            c.currencyCode, c.gdp, c.wikiHistory, c.wikiMotto],
        );
        await client.query(
          `INSERT INTO constitutions (country_id, government, economy, military, migration)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (country_id) DO UPDATE SET
             government=EXCLUDED.government, economy=EXCLUDED.economy,
             military=EXCLUDED.military, migration=EXCLUDED.migration`,
          [c.id, c.constitution.government, c.constitution.economy, c.constitution.militaryDoctrine, c.constitution.migrationPolicy],
        );
      }

      await client.query(`DELETE FROM country_hexes`);
      for (const [key, countryId] of Object.entries(s.ownership)) {
        const [q, r] = key.split(',').map(Number);
        await client.query(
          `INSERT INTO country_hexes (world_id, q, r, country_id) VALUES (1, $1, $2, $3)`,
          [q, r, countryId],
        );
      }

      for (const [countryId, inv] of Object.entries(s.inventories)) {
        for (const [resource, quantity] of Object.entries(inv)) {
          await client.query(
            `INSERT INTO inventories (country_id, resource, quantity) VALUES ($1,$2,$3)
             ON CONFLICT (country_id, resource) DO UPDATE SET quantity=EXCLUDED.quantity, updated_at=now()`,
            [countryId, resource, quantity],
          );
        }
      }

      await client.query(`DELETE FROM buildings`);
      for (const b of s.buildings) {
        await client.query(
          `INSERT INTO buildings (id, country_id, q, r, type, tier, level, workers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [b.id, b.countryId, b.hex.q, b.hex.r, b.type, b.tier, b.level, b.workers],
        );
      }

      await client.query(`DELETE FROM citizenships`);
      for (const c of s.citizenships) {
        await client.query(
          `INSERT INTO citizenships (user_id, username, country_id, role, assigned_building_id, joined_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [c.userId, c.username, c.countryId, c.role, c.assignedBuildingId, c.joinedAt],
        );
      }

      await client.query(`DELETE FROM armies`);
      for (const a of s.armies) {
        await client.query(
          `INSERT INTO armies (id, country_id, unit_type, soldiers, q, r, supply, last_moved_tick)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [a.id, a.countryId, a.unitType, a.soldiers, a.hex.q, a.hex.r, a.supply, a.lastMovedTick],
        );
      }

      await client.query(`DELETE FROM treaties`);
      for (const t of s.treaties) {
        await client.query(
          `INSERT INTO treaties (id, a, b, kind, created_at) VALUES ($1,$2,$3,$4,$5)`,
          [t.id, t.a, t.b, t.kind, t.createdAt],
        );
      }

      await client.query(`DELETE FROM wars`);
      for (const w of s.wars) {
        await client.query(
          `INSERT INTO wars (id, aggressor_id, defender_id, status, captured_hexes, winner_id, started_at, ended_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [w.id, w.aggressorId, w.defenderId, w.status, JSON.stringify(w.capturedHexes), w.winnerId, w.startedAt, w.endedAt],
        );
      }

      await client.query(`DELETE FROM assembly_proposals`);
      for (const p of s.proposals) {
        await client.query(
          `INSERT INTO assembly_proposals (id, proposer_id, kind, target_country_id, tax_percent, votes, status, closes_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.id, p.proposerId, p.kind, p.targetCountryId, p.taxPercent, JSON.stringify(p.votes), p.status, p.closesAt],
        );
      }

      await client.query(`DELETE FROM espionage_missions`);
      for (const m of s.missions) {
        await client.query(
          `INSERT INTO espionage_missions (id, spy_country_id, target_country_id, kind, status, result, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [m.id, m.spyCountryId, m.targetCountryId, m.kind, m.status, m.result, m.createdAt],
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
