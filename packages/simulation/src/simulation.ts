// ============================================================================
// @dce/simulation — Motor del mundo (authoritative simulation, docs/01 §2.1).
//
// El motor vive en RAM, muta solo dentro de sus métodos y es 100% determinista
// dado su estado de entrada: por eso cada regla es testeable en CI.
// ============================================================================

import {
  DEFAULT_CONSTITUTION,
  constitutionEffects,
  hashString,
  hexKey,
  hexNeighbors,
  isValidConstitution,
  type CountryMeta,
  type Hex,
  type ResourceType,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';
import { randomUUID } from 'node:crypto';
import {
  CG_TAX_PER_CITIZEN_PER_TICK,
  FOOD_PER_CITIZEN_PER_TICK,
  PRODUCTION_PER_RESOURCE,
  START_INVENTORIES,
} from './economy';

/** Límites de fundación (GDD §2: 10-20 hexágonos iniciales). */
export const MIN_INITIAL_HEXES = 10;
export const MAX_INITIAL_HEXES = 15;

export type SimEventType = 'famine' | 'founded';

export interface SimEvent {
  type: SimEventType;
  countryId: string;
  data: Record<string, unknown>;
}

export interface TickResult {
  tickAt: number;
  /** Inventarios actualizados por país (id → valores absolutos). */
  inventories: Map<string, Record<string, number>>;
  events: SimEvent[];
}

/** Error de reglas del juego con código legible para el cliente. */
export class SimError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SimError';
  }
}

const NAME_RE = /^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .'-]{3,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface FoundCountryInput {
  name: string;
  color: string;
  constitution: unknown;
  foundedBy: string | null;
  hex: Hex;
}

export class Simulation {
  private hexes = new Map<string, WorldHex>();
  private countries = new Map<string, CountryMeta>();
  private inventories = new Map<string, Record<string, number>>();
  private readonly seed: string;

  constructor(
    world: WorldMap,
    storedCountries: CountryMeta[] = [],
    ownershipOverrides: Map<string, string> = new Map(),
  ) {
    this.seed = world.seed;
    for (const h of world.hexes) this.hexes.set(hexKey(h), { ...h });

    // Naciones NPC del mundo base (metadatos del generador procedural).
    for (const c of world.countries) {
      this.countries.set(c.id, {
        id: c.id,
        name: c.name,
        color: c.color,
        foundedBy: null,
        capital: c.capital,
        constitution: DEFAULT_CONSTITUTION,
        population: 80 + (hashString(c.id) % 120),
        createdAt: '',
      });
    }

    // Países persistidos (jugadores). Sobrescriben/conviven con los NPC.
    for (const c of storedCountries) {
      this.countries.set(c.id, { ...c });
    }

    // Propiedad del territorio: primero el override persistido (jugadores),
    // después la asignación determinista del generador (NPC).
    for (const h of this.hexes.values()) {
      const override = ownershipOverrides.get(hexKey(h));
      if (override) h.countryId = override;
    }

    // Capitales de todas las naciones.
    for (const c of this.countries.values()) {
      const cap = this.hexes.get(hexKey(c.capital));
      if (cap) cap.isCapital = true;
    }

    for (const id of this.countries.keys()) this.inventories.set(id, { ...START_INVENTORIES });
  }

  // ── Acceso ───────────────────────────────────────────────────────────────

  getWorld(): WorldMap {
    const hexes = [...this.hexes.values()].sort((a, b) => a.q - b.q || a.r - b.r);
    return {
      seed: this.seed,
      hexCount: hexes.length,
      hexes,
      countries: this.listCountries().map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        capital: c.capital,
        npc: c.foundedBy === null && c.createdAt === '',
      })),
    };
  }

  listCountries(): CountryMeta[] {
    return [...this.countries.values()];
  }

  getCountry(id: string): CountryMeta | undefined {
    return this.countries.get(id);
  }

  getInventories(countryId: string): Record<string, number> | undefined {
    return this.inventories.get(countryId);
  }

  setInventories(countryId: string, inv: Record<string, number>): void {
    this.inventories.set(countryId, { ...START_INVENTORIES, ...inv });
  }

  ownedHexes(countryId: string): WorldHex[] {
    const out: WorldHex[] = [];
    for (const h of this.hexes.values()) if (h.countryId === countryId) out.push(h);
    return out;
  }

  // ── Fundación de naciones (GDD §2 y §3) ─────────────────────────────────

  foundCountry(input: FoundCountryInput): { country: CountryMeta; claimed: Hex[] } {
    const name = input.name.trim();
    if (!NAME_RE.test(name)) {
      throw new SimError('invalid_name', 'El nombre debe tener 3-32 caracteres válidos.');
    }
    if (!COLOR_RE.test(input.color)) {
      throw new SimError('invalid_color', 'El color debe ser un hexadecimal #rrggbb.');
    }
    if (!isValidConstitution(input.constitution)) {
      throw new SimError('invalid_constitution', 'Constitución inválida.');
    }
    const nameTaken = [...this.countries.values()].some(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    if (nameTaken) {
      throw new SimError('name_taken', `Ya existe una nación llamada "${name}".`);
    }

    const origin = this.hexes.get(hexKey(input.hex));
    if (!origin) throw new SimError('hex_not_found', 'El hexágono no existe.');
    if (origin.countryId !== null) {
      throw new SimError('hex_claimed', 'Ese hexágono ya pertenece a otra nación.');
    }

    // GDD §2: las naciones nuevas aparecen en los bordes del mundo existente.
    const isFrontier =
      origin.isCoast ||
      hexNeighbors(origin).some((n) => {
        const nh = this.hexes.get(hexKey(n));
        return nh && nh.countryId === null;
      });
    if (!isFrontier) {
      throw new SimError('not_frontier', 'Solo puedes fundar en la frontera del mundo (borde o junto a tierra libre).');
    }

    // Anexión inicial: inundación BFS por tierra libre, forma irregular.
    const claimed: WorldHex[] = [];
    const queue: Hex[] = [input.hex];
    const visited = new Set<string>();
    while (queue.length > 0 && claimed.length < MAX_INITIAL_HEXES) {
      const next = queue.shift()!;
      const k = hexKey(next);
      if (visited.has(k)) continue;
      visited.add(k);
      const hex = this.hexes.get(k);
      if (!hex || hex.countryId !== null) continue;
      claimed.push(hex);
      for (const n of hexNeighbors(next)) {
        const nk = hexKey(n);
        const nh = this.hexes.get(nk);
        if (nh && nh.countryId === null && !visited.has(nk)) queue.push(n);
      }
    }
    if (claimed.length < MIN_INITIAL_HEXES) {
      throw new SimError('land_insufficient', 'No hay suficiente tierra libre alrededor de ese hexágono.');
    }

    const id = randomUUID();
    const country: CountryMeta = {
      id,
      name,
      color: input.color,
      foundedBy: input.foundedBy,
      capital: input.hex,
      constitution: input.constitution as CountryMeta['constitution'],
      population: 100,
      createdAt: new Date().toISOString(),
    };
    for (const h of claimed) {
      h.countryId = id;
      h.isCapital = h.q === input.hex.q && h.r === input.hex.r;
    }
    this.countries.set(id, country);
    this.inventories.set(id, { ...START_INVENTORIES });

    return { country, claimed };
  }

  // ── Tick económico (GDD §4 y §5) ────────────────────────────────────────

  tick(): TickResult {
    const events: SimEvent[] = [];
    const inventories = new Map<string, Record<string, number>>();

    for (const country of this.countries.values()) {
      const inv = { ...(this.inventories.get(country.id) ?? START_INVENTORIES) };
      const owned = this.ownedHexes(country.id);
      const effects = constitutionEffects(country.constitution);

      // Producción Tier 1 según los recursos de los hexágonos propios.
      const counts = { food: 0, iron: 0, coal: 0, stone: 0, oil: 0 } as Record<ResourceType, number>;
      for (const h of owned) for (const r of h.resources) counts[r] += 1;

      for (const [res, rate] of Object.entries(PRODUCTION_PER_RESOURCE) as [ResourceType, number][]) {
        inv[res] = Math.round((inv[res] ?? 0) + counts[res] * rate * effects.production);
      }
      // Impuestos en CG según población y doctrina económica.
      inv.cg = Math.round((inv.cg ?? 0) + country.population * CG_TAX_PER_CITIZEN_PER_TICK * effects.cgIncome);

      // Consumo de comida por ciudadano (GDD §5). Sin comida → evento de hambruna.
      const consumed = country.population * FOOD_PER_CITIZEN_PER_TICK;
      inv.food = Math.max(0, (inv.food ?? 0) - consumed);
      if (inv.food <= 0 && country.population > 0) {
        events.push({ type: 'famine', countryId: country.id, data: { consumed } });
      }

      this.inventories.set(country.id, inv);
      inventories.set(country.id, inv);
    }

    return { tickAt: Date.now(), inventories, events };
  }
}
