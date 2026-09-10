// ============================================================================
// @dce/simulation — Motor del mundo (v1.0): autoridad de TODOS los sistemas.
//
// Sistemas (GDD): fundación (§2), ciudadanía (§5), economía completa (§4),
// mercado global y estados del CG (§4.1), edificios (§4.2), diplomacia y
// Asamblea (§6.3), espionaje y mercado negro (§6.2), guerra hex a hex con
// líneas de suministro (§6.1), revoluciones y golpes de estado (§5).
//
// Reglas de diseño (docs/01 §2): estado en RAM, mutaciones solo vía métodos,
// resolución de combate determinista, y persistencia por snapshot completo.
// ============================================================================

import {
  BIOME_DEFENSE,
  BLACK_MARKET_MULTIPLIER,
  BLACK_MARKET_PARIAH_MULTIPLIER,
  BUILDING_DEFS,
  CONSCRIPTION_COST_MULTIPLIER,
  DEFAULT_CONSTITUTION,
  DEFAULT_FLAG_LAYERS,
  MARKET_BASE_PRICES,
  MARKET_SPREAD,
  MAX_WORKER_BONUS,
  PROFESSIONAL_DAMAGE_BONUS,
  UNIT_DEFS,
  WORKER_BONUS_PER_WORKER,
  constitutionEffects,
  hashString,
  hexDistance,
  hexKey,
  hexNeighbors,
  isValidConstitution,
  renderFlagSvg,
  type AnyResource,
  type Army,
  type Building,
  type BuildingType,
  type Citizen,
  type CountryMeta,
  type EspionageMission,
  type FlagLayers,
  type Hex,
  type MarketQuote,
  type MissionKind,
  type NewsEvent,
  type PersistedState,
  type Proposal,
  type ProposalKind,
  type ResourceType,
  type Treaty,
  type TreatyKind,
  type UnitType,
  type War,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';
import { randomUUID } from 'node:crypto';
import {
  CG_TAX_PER_CITIZEN_PER_TICK,
  FOOD_PER_CITIZEN_PER_TICK,
  START_INVENTORIES,
} from './economy';

export const MIN_INITIAL_HEXES = 10;
export const MAX_INITIAL_HEXES = 15;

export type SimEventType = 'famine' | 'founded' | 'coup' | 'war' | 'market' | 'assembly' | 'battle';

export interface SimEvent {
  type: SimEventType;
  countryId: string;
  data: Record<string, unknown>;
}

export interface TickResult {
  tickAt: number;
  inventories: Map<string, Record<string, number>>;
  events: SimEvent[];
}

export class SimError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SimError';
  }
}

const NAME_RE = /^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .'-]{3,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function deriveCurrencyCode(name: string): string {
  const words = name.split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/).filter(Boolean);
  let code = words
    .map((w) => w[0]!.toUpperCase())
    .join('')
    .slice(0, 3);
  if (code.length < 3) code = (code + 'XXX').slice(0, 3);
  return code;
}

interface ActionCosts {
  DECLARE_WAR: number;
  MISSION: Record<MissionKind, number>;
  REJOIN_ASSEMBLY: number;
}

export const ACTION_COSTS: ActionCosts = {
  DECLARE_WAR: 1000,
  MISSION: { recon: 300, sabotage: 600, heist: 900, proxy: 700 },
  REJOIN_ASSEMBLY: 2000,
};

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
  private buildings = new Map<string, Building>();
  private citizenships = new Map<string, Citizen>(); // userId → citizen
  private armies = new Map<string, Army>();
  private treaties: Treaty[] = [];
  private wars: War[] = [];
  private proposals: Proposal[] = [];
  private missions: EspionageMission[] = [];
  private news: NewsEvent[] = [];

  private embargoes = new Set<string>();
  private globalTaxPercent = 0;
  private cgState: 'stable' | 'crisis' | 'deflation' | 'trade_war' = 'stable';
  private netSold: Record<string, number> = {};
  private cgNetHistory: number[] = [];
  private tickCount = 0;

  constructor(
    private readonly seed: string,
    world: WorldMap,
    persisted: PersistedState | null = null,
  ) {
    for (const h of world.hexes) this.hexes.set(hexKey(h), { ...h });

    // NPC del mundo base.
    for (const c of world.countries) {
      this.countries.set(c.id, this.makeCountry({
        id: c.id, name: c.name, color: c.color, foundedBy: null,
        capital: c.capital, constitution: DEFAULT_CONSTITUTION,
        population: 80 + (hashString(c.id) % 120), npc: true,
      }));
    }

    if (persisted) this.hydrate(persisted);

    // Capitales.
    for (const c of this.countries.values()) {
      const cap = this.hexes.get(hexKey(c.capital));
      if (cap) cap.isCapital = true;
    }
    // Inventarios por defecto.
    for (const id of this.countries.keys()) {
      if (!this.inventories.has(id)) this.inventories.set(id, { ...START_INVENTORIES });
    }
  }

  private makeCountry(p: Partial<CountryMeta> & { id: string; name: string }): CountryMeta {
    return {
      id: p.id,
      name: p.name,
      color: p.color ?? '#3b82f6',
      foundedBy: p.foundedBy ?? null,
      capital: p.capital ?? { q: 0, r: 0 },
      constitution: p.constitution ?? DEFAULT_CONSTITUTION,
      population: p.population ?? 100,
      createdAt: p.createdAt ?? '',
      wikiHistory: p.wikiHistory ?? '',
      wikiMotto: p.wikiMotto ?? '',
      flagSvg: p.flagSvg ?? renderFlagSvg({ ...DEFAULT_FLAG_LAYERS, colorA: p.color ?? '#3b82f6' }),
      happiness: p.happiness ?? 60,
      salary: p.salary ?? 5,
      currencyCode: p.currencyCode ?? deriveCurrencyCode(p.name),
      gdp: p.gdp ?? 0,
      rebellionStrength: p.rebellionStrength ?? 0,
      isPariah: p.isPariah ?? false,
      isPuppetOf: p.isPuppetOf ?? null,
      npc: p.npc ?? false,
    };
  }

  private hydrate(s: PersistedState): void {
    for (const c of s.countries) this.countries.set(c.id, this.makeCountry(c));
    for (const [k, v] of Object.entries(s.ownership)) {
      const h = this.hexes.get(k);
      if (h) h.countryId = v;
    }
    for (const [countryId, inv] of Object.entries(s.inventories)) {
      this.inventories.set(countryId, { ...START_INVENTORIES, ...inv });
    }
    for (const b of s.buildings) this.buildings.set(b.id, { ...b });
    for (const c of s.citizenships) this.citizenships.set(c.userId, { ...c });
    for (const a of s.armies) this.armies.set(a.id, { ...a });
    this.treaties = s.treaties.map((t) => ({ ...t }));
    this.wars = s.wars.map((w) => ({ ...w, capturedHexes: w.capturedHexes.map((h) => ({ ...h })) }));
    this.proposals = s.proposals.map((p) => ({ ...p, votes: { ...p.votes } }));
    this.missions = s.missions.map((m) => ({ ...m }));
  }

  serialize(): PersistedState {
    return {
      countries: this.listCountries().filter((c) => !c.npc),
      ownership: Object.fromEntries(
        [...this.hexes.values()].filter((h) => h.countryId !== null).map((h) => [hexKey(h), h.countryId as string]),
      ),
      inventories: Object.fromEntries(
        [...this.inventories.entries()].map(([id, inv]) => [id, { ...inv }]),
      ),
      buildings: [...this.buildings.values()].map((b) => ({ ...b })),
      citizenships: [...this.citizenships.values()].map((c) => ({ ...c })),
      armies: [...this.armies.values()].map((a) => ({ ...a })),
      treaties: this.treaties.map((t) => ({ ...t })),
      wars: this.wars.map((w) => ({ ...w, capturedHexes: w.capturedHexes.map((h) => ({ ...h })) })),
      proposals: this.proposals.map((p) => ({ ...p, votes: { ...p.votes } })),
      missions: this.missions.map((m) => ({ ...m })),
    };
  }

  // ── Acceso básico ────────────────────────────────────────────────────────

  getWorld(): WorldMap {
    const hexes = [...this.hexes.values()].sort((a, b) => a.q - b.q || a.r - b.r);
    return {
      seed: this.seed,
      hexCount: hexes.length,
      hexes,
      countries: this.listCountries().map((c) => ({
        id: c.id, name: c.name, color: c.color, capital: c.capital, npc: c.npc,
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

  getHex(q: number, r: number): WorldHex | undefined {
    return this.hexes.get(`${q},${r}`);
  }

  getCgState(): string {
    return this.cgState;
  }

  isEmbargoed(countryId: string): boolean {
    return this.embargoes.has(countryId);
  }

  getGlobalTaxPercent(): number {
    return this.globalTaxPercent;
  }

  getNews(): NewsEvent[] {
    return [...this.news].reverse();
  }

  private pushNews(kind: string, message: string, countryId: string | null = null): void {
    this.news.push({ id: randomUUID(), at: Date.now(), kind, message, countryId });
    if (this.news.length > 100) this.news.splice(0, this.news.length - 100);
  }

  private inventory(countryId: string): Record<string, number> {
    let inv = this.inventories.get(countryId);
    if (!inv) {
      inv = { ...START_INVENTORIES };
      this.inventories.set(countryId, inv);
    }
    return inv;
  }

  private canAfford(countryId: string, cost: Partial<Record<AnyResource, number>>): boolean {
    const inv = this.inventory(countryId);
    return Object.entries(cost).every(([res, qty]) => (inv[res] ?? 0) >= (qty ?? 0));
  }

  private deduct(countryId: string, cost: Partial<Record<AnyResource, number>>): void {
    const inv = this.inventory(countryId);
    for (const [res, qty] of Object.entries(cost)) inv[res] = Math.max(0, (inv[res] ?? 0) - (qty ?? 0));
  }

  // ── Fundación de naciones (GDD §2/§3) ───────────────────────────────────

  foundCountry(input: FoundCountryInput): { country: CountryMeta; claimed: Hex[] } {
    const name = input.name.trim();
    if (!NAME_RE.test(name)) throw new SimError('invalid_name', 'El nombre debe tener 3-32 caracteres válidos.');
    if (!COLOR_RE.test(input.color)) throw new SimError('invalid_color', 'El color debe ser un hexadecimal #rrggbb.');
    if (!isValidConstitution(input.constitution)) throw new SimError('invalid_constitution', 'Constitución inválida.');
    if ([...this.countries.values()].some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new SimError('name_taken', `Ya existe una nación llamada "${name}".`);
    }
    const origin = this.hexes.get(hexKey(input.hex));
    if (!origin) throw new SimError('hex_not_found', 'El hexágono no existe.');
    if (origin.countryId !== null) throw new SimError('hex_claimed', 'Ese hexágono ya pertenece a otra nación.');

    const isFrontier =
      origin.isCoast ||
      hexNeighbors(origin).some((n) => {
        const nh = this.hexes.get(hexKey(n));
        return nh && nh.countryId === null;
      });
    if (!isFrontier) {
      throw new SimError('not_frontier', 'Solo puedes fundar en la frontera del mundo (borde o junto a tierra libre).');
    }

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
    const country = this.makeCountry({
      id, name, color: input.color, foundedBy: input.foundedBy, capital: input.hex,
      constitution: input.constitution as CountryMeta['constitution'], population: 100,
      createdAt: new Date().toISOString(), npc: false,
      flagSvg: renderFlagSvg({ ...DEFAULT_FLAG_LAYERS, colorA: input.color }),
    });
    for (const h of claimed) {
      h.countryId = id;
      h.isCapital = h.q === input.hex.q && h.r === input.hex.r;
    }
    this.countries.set(id, country);
    this.inventories.set(id, { ...START_INVENTORIES });
    this.pushNews('country_created', `🌍 Se funda la nación «${name}» en la frontera del mundo.`, id);
    return { country, claimed };
  }

  // ── Ciudadanía (GDD §5) ─────────────────────────────────────────────────

  joinCountry(userId: string, username: string, countryId: string): Citizen {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (this.citizenships.has(userId)) throw new SimError('already_citizen', 'Ya eres ciudadano de una nación. Emigra primero.');
    const founderOf = [...this.countries.values()].find((c) => c.foundedBy === userId);
    if (founderOf) throw new SimError('founder_cannot_join', 'Un fundador no puede unirse como ciudadano de otra nación.');
    const citizen: Citizen = {
      userId, username, countryId, role: 'worker', assignedBuildingId: null, joinedAt: new Date().toISOString(),
    };
    this.citizenships.set(userId, citizen);
    return citizen;
  }

  leaveCountry(userId: string): void {
    const citizen = this.citizenships.get(userId);
    if (!citizen) throw new SimError('not_citizen', 'No eres ciudadano de ninguna nación.');
    if (citizen.assignedBuildingId) {
      const b = this.buildings.get(citizen.assignedBuildingId);
      if (b) b.workers = Math.max(0, b.workers - 1);
    }
    this.citizenships.delete(userId);
  }

  citizensOf(countryId: string): Citizen[] {
    return [...this.citizenships.values()].filter((c) => c.countryId === countryId);
  }

  myCitizenship(userId: string): Citizen | null {
    return this.citizenships.get(userId) ?? null;
  }

  assignWork(userId: string, buildingId: string): void {
    const citizen = this.citizenships.get(userId);
    if (!citizen) throw new SimError('not_citizen', 'Debes ser ciudadano para trabajar.');
    const building = this.buildings.get(buildingId);
    if (!building) throw new SimError('building_not_found', 'El edificio no existe.');
    if (building.countryId !== citizen.countryId) throw new SimError('foreign_building', 'Ese edificio no es de tu nación.');
    if (citizen.role !== 'worker') throw new SimError('not_worker', 'Solo los obreros pueden asignarse a edificios.');
    if (citizen.assignedBuildingId === buildingId) return;
    if (citizen.assignedBuildingId) {
      const prev = this.buildings.get(citizen.assignedBuildingId);
      if (prev) prev.workers = Math.max(0, prev.workers - 1);
    }
    citizen.assignedBuildingId = buildingId;
    building.workers += 1;
  }

  setSalary(countryId: string, amount: number): void {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000) {
      throw new SimError('invalid_salary', 'El salario debe estar entre 0 y 1000 CG.');
    }
    country.salary = Math.round(amount);
  }

  appointMinister(countryId: string, username: string): void {
    const citizen = [...this.citizenships.values()].find(
      (c) => c.countryId === countryId && c.username.toLowerCase() === username.toLowerCase(),
    );
    if (!citizen) throw new SimError('citizen_not_found', `«${username}» no es ciudadano de tu nación.`);
    citizen.role = 'minister';
    citizen.assignedBuildingId = null;
  }

  updateWiki(countryId: string, history: string, motto: string): void {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (history.length > 2000 || motto.length > 120) throw new SimError('wiki_too_long', 'Texto demasiado largo.');
    country.wikiHistory = history.trim();
    country.wikiMotto = motto.trim();
  }

  updateFlag(countryId: string, layers: FlagLayers): void {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    country.flagSvg = renderFlagSvg(layers);
  }

  // ── Edificios (GDD §4.2) ────────────────────────────────────────────────

  build(countryId: string, type: BuildingType, hex: Hex): Building {
    const def = BUILDING_DEFS[type];
    if (!def) throw new SimError('unknown_building', 'Tipo de edificio desconocido.');
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    const hexData = this.hexes.get(hexKey(hex));
    if (!hexData) throw new SimError('hex_not_found', 'El hexágono no existe.');
    if (hexData.countryId !== countryId) throw new SimError('not_yours', 'Debes construir en tu propio territorio.');
    if (def.requiresResource === 'oil' && !hexData.resources.includes('oil')) {
      throw new SimError('need_oil', 'El pozo requiere un hexágono con petróleo.');
    }
    if (def.requiresResource === 'iron' && !hexData.resources.some((r) => r === 'iron' || r === 'coal' || r === 'stone')) {
      throw new SimError('need_minerals', 'La mina requiere hierro, carbón o piedra en el hexágono.');
    }
    if (!this.canAfford(countryId, def.cost)) {
      throw new SimError('cannot_afford', 'Recursos insuficientes para construir.');
    }
    this.deduct(countryId, def.cost);
    const building: Building = {
      id: randomUUID(), countryId, hex: { q: hex.q, r: hex.r }, type, tier: def.tier, level: 1, workers: 0,
    };
    this.buildings.set(building.id, building);
    return building;
  }

  buildingsOf(countryId: string): Building[] {
    return [...this.buildings.values()].filter((b) => b.countryId === countryId);
  }

  // ── Mercado global y mercado negro (GDD §4.1, §6.2) ─────────────────────

  private supplyFactor(resource: string): number {
    const net = this.netSold[resource] ?? 0;
    return Math.min(2.5, Math.max(0.5, 1 + net / 5000));
  }

  marketAccessBlocked(countryId: string): boolean {
    const country = this.countries.get(countryId);
    if (!country) return false;
    return country.isPariah || this.embargoes.has(countryId) || this.cgState === 'trade_war';
  }

  marketQuotes(): { cgState: string; blocked: boolean; quotes: MarketQuote[] } {
    const stateMult = this.cgState === 'crisis' ? 1.5 : this.cgState === 'deflation' ? 0.7 : 1;
    const quotes: MarketQuote[] = Object.keys(MARKET_BASE_PRICES).map((res) => {
      const price = MARKET_BASE_PRICES[res as AnyResource]! * this.supplyFactor(res) * stateMult;
      return { resource: res as AnyResource, buy: round2(price * (1 + MARKET_SPREAD)), sell: round2(price * (1 - MARKET_SPREAD)) };
    });
    return { cgState: this.cgState, blocked: this.cgState === 'trade_war', quotes };
  }

  marketBuy(countryId: string, resource: AnyResource, qty: number): void {
    if (resource === 'cg') throw new SimError('invalid_resource', 'No puedes comprar CG con CG.');
    if (this.marketAccessBlocked(countryId)) {
      throw new SimError('market_blocked', 'Sin acceso al mercado global (paria, embargo o guerra comercial). Usa el mercado negro.');
    }
    const q = Math.max(1, Math.floor(qty));
    const quote = this.marketQuotes().quotes.find((x) => x.resource === resource)!;
    const cost = quote.buy * q;
    const inv = this.inventory(countryId);
    if ((inv.cg ?? 0) < cost) throw new SimError('cannot_afford', 'CG insuficiente para la compra.');
    inv.cg = round2(inv.cg! - cost);
    inv[resource] = (inv[resource] ?? 0) + q;
    this.netSold[resource] = (this.netSold[resource] ?? 0) - q;
  }

  marketSell(countryId: string, resource: AnyResource, qty: number): void {
    if (resource === 'cg') throw new SimError('invalid_resource', 'El CG es dinero: no se vende.');
    if (this.marketAccessBlocked(countryId)) {
      throw new SimError('market_blocked', 'Sin acceso al mercado global (paria, embargo o guerra comercial). Usa el mercado negro.');
    }
    const q = Math.max(1, Math.floor(qty));
    const inv = this.inventory(countryId);
    if ((inv[resource] ?? 0) < q) throw new SimError('not_enough', `No tienes ${q} de ${resource}.`);
    const quote = this.marketQuotes().quotes.find((x) => x.resource === resource)!;
    inv[resource] = (inv[resource] ?? 0) - q;
    inv.cg = round2(inv.cg! + quote.sell * q);
    this.netSold[resource] = (this.netSold[resource] ?? 0) + q;
  }

  blackMarketQuotes(countryId: string): MarketQuote[] {
    const country = this.countries.get(countryId);
    const mult = country?.isPariah ? BLACK_MARKET_PARIAH_MULTIPLIER : BLACK_MARKET_MULTIPLIER;
    return Object.keys(MARKET_BASE_PRICES)
      .filter((r) => r !== 'cg')
      .map((res) => {
        const price = MARKET_BASE_PRICES[res as AnyResource]! * this.supplyFactor(res) * mult;
        return { resource: res as AnyResource, buy: round2(price), sell: round2(price * 0.9) };
      });
  }

  blackMarketBuy(countryId: string, resource: AnyResource, qty: number): void {
    if (resource === 'cg') throw new SimError('invalid_resource', 'No puedes comprar CG.');
    const q = Math.max(1, Math.floor(qty));
    const quote = this.blackMarketQuotes(countryId).find((x) => x.resource === resource)!;
    const cost = quote.buy * q;
    const inv = this.inventory(countryId);
    if ((inv.cg ?? 0) < cost) throw new SimError('cannot_afford', 'CG insuficiente para el contrabando.');
    inv.cg = round2(inv.cg! - cost);
    inv[resource] = (inv[resource] ?? 0) + q;
    this.netSold[resource] = (this.netSold[resource] ?? 0) - q;
  }

  // ── Diplomacia: tratados, guerra, paz (GDD §6.1, §6.3) ─────────────────

  treatiesOf(countryId: string): Treaty[] {
    return this.treaties.filter((t) => t.a === countryId || t.b === countryId);
  }

  proposeTreaty(a: string, b: string, kind: TreatyKind): Treaty {
    if (a === b) throw new SimError('self_treaty', 'No puedes firmar tratados contigo mismo.');
    if (!this.countries.has(a) || !this.countries.has(b)) throw new SimError('country_not_found', 'País inexistente.');
    if (this.treaties.some((t) => new Set([t.a, t.b]).has(a) && new Set([t.a, t.b]).has(b) && t.kind === kind)) {
      throw new SimError('treaty_exists', 'Ese tratado ya existe entre ambos países.');
    }
    const treaty: Treaty = { id: randomUUID(), a, b, kind, createdAt: new Date().toISOString() };
    this.treaties.push(treaty);
    this.pushNews('treaty', `🤝 Tratado de ${kindLabel(kind)} entre ${this.countries.get(a)!.name} y ${this.countries.get(b)!.name}.`, a);
    return treaty;
  }

  warsOf(countryId: string): War[] {
    return this.wars.filter((w) => (w.aggressorId === countryId || w.defenderId === countryId) && w.status === 'active');
  }

  allWars(): War[] {
    return this.wars;
  }

  declareWar(aggressorId: string, defenderId: string): War[] {
    if (aggressorId === defenderId) throw new SimError('self_war', 'No puedes declararte la guerra a ti mismo.');
    const aggressor = this.countries.get(aggressorId);
    const defender = this.countries.get(defenderId);
    if (!aggressor || !defender) throw new SimError('country_not_found', 'País inexistente.');
    if (this.warsOf(aggressorId).some((w) => w.defenderId === defenderId)) {
      throw new SimError('war_exists', 'Ya estás en guerra con ese país.');
    }
    if (defender.isPuppetOf) throw new SimError('puppet', 'No puedes atacar a un estado títere directamente.');
    if (this.treaties.some((t) => t.kind === 'non_aggression' && new Set([t.a, t.b]).has(aggressorId) && new Set([t.a, t.b]).has(defenderId))) {
      throw new SimError('non_aggression', 'Un tratado de no agresión lo impide.');
    }
    if (!this.canAfford(aggressorId, { cg: ACTION_COSTS.DECLARE_WAR })) {
      throw new SimError('cannot_afford', `Declarar la guerra cuesta ${ACTION_COSTS.DECLARE_WAR} CG.`);
    }
    this.deduct(aggressorId, { cg: ACTION_COSTS.DECLARE_WAR });

    const created: War[] = [];
    const create = (def: string) => {
      const war: War = {
        id: randomUUID(), aggressorId, defenderId: def, status: 'active',
        capturedHexes: [], winnerId: null, startedAt: new Date().toISOString(), endedAt: null,
      };
      this.wars.push(war);
      created.push(war);
      this.pushNews('war_declared', `⚔️ ¡${aggressor.name} declara la guerra a ${this.countries.get(def)!.name}!`, aggressorId);
    };
    create(defenderId);
    // Defensa mutua: los aliados del defensor entran en la guerra (GDD §6.3).
    for (const t of this.treaties.filter((x) => x.kind === 'mutual_defense')) {
      const allyId = t.a === defenderId ? t.b : t.b === defenderId ? t.a : null;
      if (allyId && allyId !== aggressorId && !this.warsOf(aggressorId).some((w) => w.defenderId === allyId)) {
        create(allyId);
      }
    }
    return created;
  }

  settleWar(warId: string, proposerId: string, terms: 'annex' | 'indemnity' | 'puppet' | 'white_peace'): void {
    const war = this.wars.find((w) => w.id === warId);
    if (!war || war.status !== 'active') throw new SimError('war_not_found', 'La guerra no existe o ya terminó.');
    if (proposerId !== war.aggressorId && proposerId !== war.defenderId) {
      throw new SimError('not_in_war', 'No participas en esta guerra.');
    }
    const aggressor = this.countries.get(war.aggressorId)!;
    const defender = this.countries.get(war.defenderId)!;

    if (terms === 'white_peace') {
      // Se devuelven los hexágonos capturados.
      for (const h of war.capturedHexes) {
        const hex = this.hexes.get(hexKey(h));
        if (hex && hex.countryId === war.aggressorId) hex.countryId = war.defenderId;
      }
      war.winnerId = null;
    } else {
      if (proposerId !== war.aggressorId) {
        throw new SimError('loser_terms', 'Solo el agresor puede imponer anexión, indemnización o títere.');
      }
      if (terms === 'annex') {
        if (war.capturedHexes.length === 0) throw new SimError('nothing_captured', 'No has capturado territorio que anexar.');
        war.winnerId = war.aggressorId;
      } else if (terms === 'indemnity') {
        const defInv = this.inventory(defender.id);
        const amount = Math.floor((defInv.cg ?? 0) * 0.25);
        this.deduct(defender.id, { cg: amount });
        this.inventory(aggressor.id).cg = round2(this.inventory(aggressor.id).cg! + amount);
        war.winnerId = war.aggressorId;
      } else {
        defender.isPuppetOf = aggressor.id;
        war.winnerId = war.aggressorId;
      }
    }
    war.status = 'ended';
    war.endedAt = new Date().toISOString();
    const termsLabel = { annex: 'anexión', indemnity: 'indemnización', puppet: 'estado títere', white_peace: 'paz blanca' }[terms];
    this.pushNews('war_ended', `🕊️ Fin de la guerra entre ${aggressor.name} y ${defender.name} (${termsLabel}).`, war.aggressorId);
  }

  // ── Ejércitos y combate (GDD §6.1) ──────────────────────────────────────

  armiesOf(countryId: string): Army[] {
    return [...this.armies.values()].filter((a) => a.countryId === countryId);
  }

  allArmies(): Army[] {
    return [...this.armies.values()];
  }

  recruit(countryId: string, unitType: UnitType): Army {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    const def = UNIT_DEFS[unitType];
    const costCg = country.constitution.militaryDoctrine === 'conscription'
      ? def.costCg * CONSCRIPTION_COST_MULTIPLIER
      : def.costCg;
    const cost = { cg: costCg, ...def.costRes };
    if (!this.canAfford(countryId, cost)) throw new SimError('cannot_afford', 'Recursos insuficientes para reclutar.');
    this.deduct(countryId, cost);
    const army: Army = {
      id: randomUUID(), countryId, unitType, soldiers: def.soldiers,
      hex: { q: country.capital.q, r: country.capital.r }, supply: true, lastMovedTick: this.tickCount,
    };
    this.armies.set(army.id, army);
    return army;
  }

  moveArmy(armyId: string, hex: Hex): Army {
    const army = this.armies.get(armyId);
    if (!army) throw new SimError('army_not_found', 'El ejército no existe.');
    const target = this.hexes.get(hexKey(hex));
    if (!target) throw new SimError('hex_not_found', 'El hexágono no existe.');
    if (hexDistance(army.hex, hex) !== 1) throw new SimError('not_adjacent', 'Solo puedes moverte a hexágonos adyacentes.');
    if (army.lastMovedTick >= this.tickCount) throw new SimError('cooldown', 'Este ejército ya se movió en el Tick actual (1 movimiento por Tick).');
    if (target.countryId !== army.countryId) {
      throw new SimError('enemy_hex', 'Ese hexágono no es tuyo: usa la orden de ataque.');
    }
    army.hex = { q: hex.q, r: hex.r };
    army.lastMovedTick = this.tickCount;
    return army;
  }

  attackHex(armyId: string, hex: Hex): { result: 'captured' | 'repelled' | 'contested'; army: Army; message: string } {
    const army = this.armies.get(armyId);
    if (!army) throw new SimError('army_not_found', 'El ejército no existe.');
    const target = this.hexes.get(hexKey(hex));
    if (!target) throw new SimError('hex_not_found', 'El hexágono no existe.');
    if (hexDistance(army.hex, hex) !== 1) throw new SimError('not_adjacent', 'Solo puedes atacar hexágonos adyacentes.');
    if (target.countryId === army.countryId) throw new SimError('friendly_hex', 'No puedes atacar tu propio territorio.');
    if (target.countryId === null) throw new SimError('neutral_hex', 'No puedes atacar tierra libre.');
    if (army.lastMovedTick >= this.tickCount) throw new SimError('cooldown', 'Este ejército ya actuó en el Tick actual.');
    const defenderId = target.countryId;
    const war = this.wars.find(
      (w) => w.status === 'active' &&
        ((w.aggressorId === army.countryId && w.defenderId === defenderId) ||
         (w.aggressorId === defenderId && w.defenderId === army.countryId)),
    );
    if (!war) throw new SimError('no_war', 'Debes declarar la guerra antes de atacar.');

    army.lastMovedTick = this.tickCount;
    const attackers = this.armiesOf(army.countryId).filter((a) => hexKey(a.hex) === hexKey(army.hex) && a.id !== army.id);
    attackers.push(army);
    const defenders = this.armiesOf(defenderId).filter((a) => hexKey(a.hex) === hexKey(hex));

    const attackerCountry = this.countries.get(army.countryId)!;
    const professional = attackerCountry.constitution.militaryDoctrine === 'professional' ? PROFESSIONAL_DAMAGE_BONUS : 1;
    const supplyMult = army.supply ? 1 : 0.5;
    let atkPower = 0;
    for (const a of attackers) {
      const def = UNIT_DEFS[a.unitType];
      let bestVs = 1;
      for (const d of defenders) bestVs = Math.max(bestVs, def.vs[d.unitType]);
      atkPower += a.soldiers * def.power * bestVs * professional * supplyMult;
    }
    let defPower = 0;
    for (const d of defenders) {
      const def = UNIT_DEFS[d.unitType];
      let bestVs = 1;
      for (const a of attackers) bestVs = Math.max(bestVs, def.vs[a.unitType]);
      defPower += d.soldiers * def.defense * bestVs * (1 + BIOME_DEFENSE[target.biome]) * 1.1;
    }

    const messageParts: string[] = [];
    let result: 'captured' | 'repelled' | 'contested';

    if (defPower === 0) {
      // Hexágono sin guarnición: la infantería ocupa directamente.
      const hasInfantry = attackers.some((a) => a.unitType === 'infantry');
      if (hasInfantry) {
        target.countryId = army.countryId;
        war.capturedHexes.push({ q: hex.q, r: hex.r });
        result = 'captured';
        messageParts.push(`Territorio ocupado sin resistencia.`);
      } else {
        result = 'contested';
        messageParts.push('Sin infantería no puedes ocupar el hexágono.');
      }
    } else {
      const ratio = defPower === 0 ? Infinity : atkPower / defPower;
      if (ratio >= 1.3) {
        for (const d of defenders) this.armies.delete(d.id);
        for (const a of attackers) a.soldiers = Math.max(1, Math.round(a.soldiers * 0.85));
        const hasInfantry = attackers.some((a) => a.unitType === 'infantry');
        if (hasInfantry) {
          target.countryId = army.countryId;
          war.capturedHexes.push({ q: hex.q, r: hex.r });
          result = 'captured';
        } else {
          result = 'contested';
        }
        messageParts.push(`Victoria: guarnición destruida${hasInfantry ? ' y territorio ocupado' : ' (sin infantería para ocupar)'}.`);
        if (attackers.some((a) => a.unitType === 'artillery')) this.damageBuildingAt(hex, defenderId);
      } else if (ratio <= 0.77) {
        for (const a of attackers) a.soldiers = Math.max(1, Math.round(a.soldiers * 0.55));
        for (const d of defenders) d.soldiers = Math.max(1, Math.round(d.soldiers * 0.9));
        result = 'repelled';
        messageParts.push('Ataque repelido: el terreno y la defensa superaron al asalto.');
      } else {
        for (const a of attackers) a.soldiers = Math.max(1, Math.round(a.soldiers * 0.7));
        for (const d of defenders) d.soldiers = Math.max(1, Math.round(d.soldiers * 0.7));
        result = 'contested';
        messageParts.push('Combate indeciso: ambos bandos sufren bajas.');
      }
    }

    if (army.soldiers <= 0) this.armies.delete(army.id);
    const capHex = target;
    if (result === 'captured' && capHex.isCapital) {
      messageParts.push(`¡La capital de ${this.countries.get(defenderId)!.name} ha caído!`);
      this.pushNews('battle', `⚔️ ¡La capital de ${this.countries.get(defenderId)!.name} ha caído ante ${attackerCountry.name}!`, defenderId);
    }
    this.pushNews('battle', `⚔️ Batalla en (${hex.q},${hex.r}): ${messageParts.join(' ')}`, army.countryId);
    return { result, army, message: messageParts.join(' ') };
  }

  private damageBuildingAt(hex: Hex, countryId: string): void {
    const building = this.buildingsOf(countryId).find((b) => b.hex.q === hex.q && b.hex.r === hex.r);
    if (building) {
      if (building.level > 1) building.level -= 1;
      else this.buildings.delete(building.id);
    }
  }

  // ── Asamblea Global ("ONU", GDD §6.3) ───────────────────────────────────

  listProposals(): Proposal[] {
    return this.proposals.filter((p) => p.status === 'open');
  }

  propose(countryId: string, kind: ProposalKind, targetCountryId: string | null, taxPercent: number): Proposal {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (country.isPariah) throw new SimError('pariah', 'Un estado paria no participa en la Asamblea.');
    if (kind === 'embargo' && (!targetCountryId || !this.countries.has(targetCountryId))) {
      throw new SimError('bad_target', 'El embargo requiere un país objetivo.');
    }
    if (kind === 'tax' && (!Number.isFinite(taxPercent) || taxPercent <= 0 || taxPercent > 25)) {
      throw new SimError('bad_tax', 'El impuesto global debe estar entre 1 y 25%.');
    }
    const proposal: Proposal = {
      id: randomUUID(), proposerId: countryId, kind,
      targetCountryId: kind === 'embargo' ? targetCountryId : null,
      taxPercent: kind === 'tax' ? Math.round(taxPercent) : 0,
      votes: { [countryId]: 'yes' }, status: 'open', closesAt: Date.now() + 60_000,
    };
    this.proposals.push(proposal);
    this.pushNews('assembly', `🏛️ ${country.name} propone ${kind === 'embargo' ? `un embargo contra ${this.countries.get(targetCountryId!)!.name}` : `un impuesto global del ${taxPercent}%`}.`, countryId);
    return proposal;
  }

  vote(countryId: string, proposalId: string, vote: 'yes' | 'no' | 'abstain'): void {
    const country = this.countries.get(countryId);
    const proposal = this.proposals.find((p) => p.id === proposalId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (country.isPariah) throw new SimError('pariah', 'Un estado paria no vota en la Asamblea.');
    if (!proposal || proposal.status !== 'open') throw new SimError('proposal_not_found', 'La propuesta no existe o ya cerró.');
    proposal.votes[countryId] = vote;
  }

  withdrawFromAssembly(countryId: string): void {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (country.isPariah) throw new SimError('already_pariah', 'Ya eres un estado independiente (paria).');
    country.isPariah = true;
    this.pushNews('pariah', `🚩 ${country.name} se retira de la Asamblea Global: estado independiente (paria).`, countryId);
  }

  rejoinAssembly(countryId: string): void {
    const country = this.countries.get(countryId);
    if (!country) throw new SimError('country_not_found', 'El país no existe.');
    if (!country.isPariah) throw new SimError('member', 'Ya eres miembro de la Asamblea.');
    if (!this.canAfford(countryId, { cg: ACTION_COSTS.REJOIN_ASSEMBLY })) {
      throw new SimError('cannot_afford', `Reincorporarse cuesta ${ACTION_COSTS.REJOIN_ASSEMBLY} CG.`);
    }
    this.deduct(countryId, { cg: ACTION_COSTS.REJOIN_ASSEMBLY });
    country.isPariah = false;
    this.pushNews('assembly', `🏛️ ${country.name} se reincorpora a la Asamblea Global.`, countryId);
  }

  // ── Espionaje (GDD §6.2) ────────────────────────────────────────────────

  launchMission(spyCountryId: string, targetCountryId: string, kind: MissionKind, rng: () => number = Math.random): EspionageMission {
    if (spyCountryId === targetCountryId) throw new SimError('self_mission', 'No puedes espiarte a ti mismo.');
    const spy = this.countries.get(spyCountryId);
    const target = this.countries.get(targetCountryId);
    if (!spy || !target) throw new SimError('country_not_found', 'País inexistente.');
    const cost = ACTION_COSTS.MISSION[kind];
    if (!this.canAfford(spyCountryId, { cg: cost })) {
      throw new SimError('cannot_afford', `La misión cuesta ${cost} CG.`);
    }
    this.deduct(spyCountryId, { cg: cost });

    const mission: EspionageMission = {
      id: randomUUID(), spyCountryId, targetCountryId, kind,
      status: rng() < 0.6 ? 'success' : 'failed', result: null, createdAt: new Date().toISOString(),
    };
    if (mission.status === 'success') {
      if (kind === 'recon') {
        const armies = this.armiesOf(targetCountryId);
        mission.result = `${armies.length} ejército(s) detectado(s): ${armies.map((a) => `${UNIT_DEFS[a.unitType].label}(${a.soldiers}) en (${a.hex.q},${a.hex.r})`).join('; ') || 'sin tropas'}`;
      } else if (kind === 'sabotage') {
        const buildings = this.buildingsOf(targetCountryId);
        if (buildings.length > 0) {
          const victim = buildings[Math.floor(rng() * buildings.length)]!;
          this.buildings.delete(victim.id);
          mission.result = `Sabotaje: destruida la ${BUILDING_DEFS[victim.type]!.label} en (${victim.hex.q},${victim.hex.r}).`;
        } else {
          mission.result = 'Sin edificios que sabotear.';
        }
      } else if (kind === 'heist') {
        const targetInv = this.inventory(targetCountryId);
        const stolen = Math.floor((targetInv.cg ?? 0) * 0.1);
        this.deduct(targetCountryId, { cg: stolen });
        this.inventory(spyCountryId).cg = round2(this.inventory(spyCountryId).cg! + stolen);
        mission.result = `Robo al banco central: ${stolen} CG transferidos.`;
      } else {
        target.rebellionStrength = round2(target.rebellionStrength + 8);
        mission.result = 'Guerra proxy: rebeldes financiados en el país objetivo.';
      }
      this.pushNews('espionage', `🕵️ ${kindLabel(kind)} de ${spy.name} contra ${target.name}… éxito.`, spyCountryId);
    } else {
      mission.result = 'La misión fracasó sin consecuencias.';
      this.pushNews('espionage', `🕵️ Misión de ${spy.name} contra ${target.name} fracasó.`, spyCountryId);
    }
    this.missions.push(mission);
    return mission;
  }

  missionsOf(countryId: string): EspionageMission[] {
    return this.missions
      .filter((m) => m.spyCountryId === countryId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }

  // ── Revoluciones (GDD §5) ───────────────────────────────────────────────

  joinRebellion(userId: string, countryId: string): void {
    const citizen = this.citizenships.get(userId);
    if (!citizen || citizen.countryId !== countryId) throw new SimError('not_citizen', 'Solo los ciudadanos del país pueden rebelarse.');
    const country = this.countries.get(countryId)!;
    country.rebellionStrength = round2(country.rebellionStrength + 2);
    this.pushNews('rebellion', `🔥 Un ciudadano se une a la rebelión en ${country.name}.`, countryId);
  }

  coupAttempt(userId: string, countryId: string, rng: () => number = Math.random): { success: boolean; message: string } {
    const citizen = this.citizenships.get(userId);
    if (!citizen || citizen.countryId !== countryId) throw new SimError('not_citizen', 'Solo los ciudadanos pueden dar un golpe de estado.');
    const country = this.countries.get(countryId)!;
    const strength = country.rebellionStrength;
    if (strength < 3) throw new SimError('weak_rebellion', 'La rebelión aún es demasiado débil.');
    const successProb = strength / (strength + 8);
    if (rng() < successProb) {
      country.foundedBy = userId;
      country.rebellionStrength = 0;
      country.happiness = 60;
      this.pushNews('coup', `💥 ¡Golpe de estado en ${country.name}! ${citizen.username} toma el poder.`, countryId);
      return { success: true, message: `¡Revolución victoriosa! ${citizen.username} es ahora el nuevo líder de ${country.name}.` };
    }
    country.rebellionStrength = round2(strength * 0.5);
    country.happiness = Math.max(0, country.happiness - 10);
    this.pushNews('coup', `💥 Golpe de estado fallido en ${country.name}: la rebelión se debilita.`, countryId);
    return { success: false, message: 'El golpe fracasó: la rebelión pierde fuerza y la felicidad cae.' };
  }

  // ── TICK: economía, logística, guerra y política (GDD §4, §5, §6) ───────

  private connectedToCapital(countryId: string): Set<string> {
    const country = this.countries.get(countryId);
    const connected = new Set<string>();
    if (!country) return connected;
    const capKey = hexKey(country.capital);
    if (!this.hexes.get(capKey) || this.hexes.get(capKey)!.countryId !== countryId) return connected;
    const queue = [capKey];
    connected.add(capKey);
    while (queue.length > 0) {
      const k = queue.shift()!;
      const h = this.hexes.get(k)!;
      for (const n of hexNeighbors(h)) {
        const nk = hexKey(n);
        const nh = this.hexes.get(nk);
        if (nh && nh.countryId === countryId && !connected.has(nk)) {
          connected.add(nk);
          queue.push(nk);
        }
      }
    }
    return connected;
  }

  tick(rng: () => number = Math.random): TickResult {
    this.tickCount += 1;
    const events: SimEvent[] = [];
    const inventories = new Map<string, Record<string, number>>();
    const quotes = this.marketQuotes().quotes;
    const priceOf = (r: string) => quotes.find((q) => q.resource === r)?.sell ?? 1;

    let cgCreatedThisTick = 0;
    let cgDestroyedThisTick = 0;

    for (const country of this.countries.values()) {
      const inv = { ...(this.inventory(country.id)) };
      const connected = this.connectedToCapital(country.id);
      const effects = constitutionEffects(country.constitution);

      // 1) Producción Tier 1 (solo hexágonos conectados a la capital: logística).
      const owned = this.ownedHexes(country.id);
      const connectedHexes = owned.filter((h) => connected.has(hexKey(h)));
      const counts = { food: 0, iron: 0, coal: 0, stone: 0, oil: 0 } as Record<ResourceType, number>;
      for (const h of connectedHexes) for (const r of h.resources) counts[r] += 1;
      const production: Record<string, number> = {};
      for (const [res, rate] of Object.entries({ food: 120, iron: 60, coal: 60, stone: 40, oil: 80 })) {
        production[res] = counts[res as ResourceType] * rate * effects.production;
      }

      // 2) Edificios (Tier 1→3) con bonificación de trabajadores.
      const buildings = this.buildingsOf(country.id);
      const workersTotal = this.citizensOf(country.id).filter((c) => c.role === 'worker').length;
      let goodsProduced = 0;
      let unpaidSalary = false;
      for (const b of buildings) {
        if (!connected.has(hexKey(b.hex))) continue; // logística cortada → paralizado
        const def = BUILDING_DEFS[b.type]!;
        const workerBonus = 1 + Math.min(MAX_WORKER_BONUS, b.workers * WORKER_BONUS_PER_WORKER);
        const hexData = this.hexes.get(hexKey(b.hex))!;
        // Inputs: si faltan, el edificio no produce este Tick.
        let canRun = true;
        if (def.input) {
          for (const [res, qty] of Object.entries(def.input)) {
            if ((inv[res] ?? 0) < (qty ?? 0)) { canRun = false; break; }
          }
        }
        if (canRun) {
          if (def.input) for (const [res, qty] of Object.entries(def.input)) inv[res] = (inv[res] ?? 0) - (qty ?? 0);
          if (def.output) {
            for (const [res, qty] of Object.entries(def.output)) {
              let out = (qty ?? 0) * workerBonus;
              if (def.bonusResource && hexData.resources.includes(def.bonusResource as ResourceType)) out *= 1.5;
              production[res] = (production[res] ?? 0) + out;
              if (res === 'goods') goodsProduced += out;
            }
          }
          if (def.perResource) {
            for (const [res, qty] of Object.entries(def.perResource)) {
              if (hexData.resources.includes(res as ResourceType)) {
                production[res] = (production[res] ?? 0) + (qty ?? 0) * workerBonus;
              }
            }
          }
        }
      }
      for (const [res, qty] of Object.entries(production)) inv[res] = Math.round((inv[res] ?? 0) + qty);

      // 3) Impuestos en CG (menos ley global y sanciones).
      let cgIncome = country.population * CG_TAX_PER_CITIZEN_PER_TICK * effects.cgIncome;
      if (!country.isPariah) cgIncome *= 1 - this.globalTaxPercent / 100;
      if (this.embargoes.has(country.id)) cgIncome *= 0.5;
      cgIncome = Math.round(cgIncome);
      inv.cg = round2((inv.cg ?? 0) + cgIncome);
      cgCreatedThisTick += cgIncome;

      // 4) Tributo de estado títere (GDD §6.1: 30% de recursos).
      if (country.isPuppetOf && this.countries.has(country.isPuppetOf)) {
        const masterInv = this.inventory(country.isPuppetOf);
        for (const [res, qty] of Object.entries(production)) {
          const tribute = Math.round((qty ?? 0) * 0.3);
          inv[res] = Math.round((inv[res] ?? 0) - tribute);
          masterInv[res] = Math.round((masterInv[res] ?? 0) + tribute);
        }
      }

      // 5) Salarios: deducir CG por obreros con trabajo asignado.
      const salaried = this.citizensOf(country.id).filter((c) => c.role === 'worker' && c.assignedBuildingId);
      const wageTotal = salaried.length * country.salary;
      if ((inv.cg ?? 0) >= wageTotal) {
        inv.cg = round2(inv.cg! - wageTotal);
      } else {
        unpaidSalary = true;
      }

      // 6) Consumo de comida (GDD §5).
      const consumed = country.population * FOOD_PER_CITIZEN_PER_TICK;
      inv.food = Math.max(0, (inv.food ?? 0) - consumed);
      const famine = inv.food <= 0 && country.population > 0;
      if (famine) events.push({ type: 'famine', countryId: country.id, data: { consumed } });

      // 7) Población según política migratoria (GDD §3.2).
      country.population += country.constitution.migrationPolicy === 'open_borders' ? 4 : 1;

      // 8) Felicidad.
      let happiness = 50;
      if ((inv.food ?? 0) > consumed * 2) happiness += 15;
      if (famine) happiness -= 25;
      if (unpaidSalary) happiness -= 10;
      if (goodsProduced > 0) happiness += 5;
      if (country.constitution.government === 'democracy') happiness += 5;
      if (country.constitution.government === 'autocracy') happiness -= 10;
      country.happiness = Math.max(0, Math.min(100, Math.round(happiness)));

      // 9) Rebelión interna: crece con el descontento (GDD §5).
      if (country.happiness < 30) {
        country.rebellionStrength = round2(country.rebellionStrength + ((30 - country.happiness) / 10) * (country.population / 500 + 0.2));
      } else {
        country.rebellionStrength = round2(country.rebellionStrength * 0.9);
      }

      // 10) PIB y moneda local (GDD §4.1: valor ligado a producción y reservas).
      let gdp = cgIncome;
      for (const [res, qty] of Object.entries(production)) gdp += qty * priceOf(res);
      country.gdp = Math.round(gdp);

      this.inventories.set(country.id, inv);
      inventories.set(country.id, inv);
    }

    // ── Líneas de suministro militar (GDD §6.1) ────────────────────────────
    for (const army of this.armies.values()) {
      const connected = this.connectedToCapital(army.countryId);
      army.supply = connected.has(hexKey(army.hex));
      if (!army.supply) {
        army.soldiers = Math.round(army.soldiers * 0.85);
        if (army.soldiers < 10) this.armies.delete(army.id);
      }
    }

    // ── Estados del Crédito Global (GDD §4.1) ──────────────────────────────
    let totalCg = 0;
    let topShare = 0;
    for (const [, inv] of this.inventories) {
      totalCg += inv.cg ?? 0;
      topShare = Math.max(topShare, inv.cg ?? 0);
    }
    const share = totalCg > 0 ? topShare / totalCg : 0;
    this.cgNetHistory.push(cgCreatedThisTick - cgDestroyedThisTick);
    if (this.cgNetHistory.length > 5) this.cgNetHistory.shift();
    const netLastTicks = this.cgNetHistory.reduce((a, b) => a + b, 0);

    const prevState = this.cgState;
    if (share > 0.5) this.cgState = 'trade_war';
    else if (netLastTicks > 0.15 * Math.max(totalCg, 1)) this.cgState = 'crisis';
    else if (netLastTicks < 0) this.cgState = 'deflation';
    else this.cgState = 'stable';
    if (this.cgState !== prevState) {
      const labels = { stable: 'estable', crisis: 'CRISIS (inflación)', deflation: 'DEFLACIÓN', trade_war: 'GUERRA COMERCIAL' };
      this.pushNews('market', `💱 El Crédito Global entra en estado de ${labels[this.cgState]}.`, null);
      events.push({ type: 'market', countryId: '', data: { state: this.cgState } });
    }

    // ── Resolución de propuestas de la Asamblea ────────────────────────────
    for (const p of this.proposals.filter((x) => x.status === 'open' && x.closesAt <= Date.now())) {
      let yes = 0;
      let no = 0;
      for (const [countryId, vote] of Object.entries(p.votes)) {
        const c = this.countries.get(countryId);
        if (!c || c.isPariah) continue;
        const weight = c.gdp + c.population * 5;
        if (vote === 'yes') yes += weight;
        if (vote === 'no') no += weight;
      }
      p.status = yes > no ? 'passed' : 'rejected';
      if (p.status === 'passed') {
        if (p.kind === 'embargo' && p.targetCountryId) {
          this.embargoes.add(p.targetCountryId);
          this.pushNews('assembly', `🚫 La Asamblea aprueba un embargo contra ${this.countries.get(p.targetCountryId)!.name}.`, p.targetCountryId);
        } else if (p.kind === 'tax') {
          this.globalTaxPercent = p.taxPercent;
          this.pushNews('assembly', `🧾 La Asamblea aprueba un impuesto global del ${p.taxPercent}%.`, null);
        }
        events.push({ type: 'assembly', countryId: p.proposerId, data: { proposalId: p.id } });
      } else {
        this.pushNews('assembly', `🏛️ Propuesta rechazada por la Asamblea.`, p.proposerId);
      }
    }

    // ── Golpes de estado automáticos ───────────────────────────────────────
    for (const country of this.countries.values()) {
      if (country.rebellionStrength > 5 && rng() < 0.4) {
        const rebels = this.citizensOf(country.id).filter((c) => c.role !== 'minister');
        const leader = rebels.length > 0 ? rebels[Math.floor(rng() * rebels.length)]! : null;
        const successProb = country.rebellionStrength / (country.rebellionStrength + 8);
        if (rng() < successProb && leader) {
          country.foundedBy = leader.userId;
          country.rebellionStrength = 0;
          country.happiness = 60;
          events.push({ type: 'coup', countryId: country.id, data: { leader: leader.username } });
          this.pushNews('coup', `💥 ¡Golpe de estado en ${country.name}! ${leader.username} toma el poder.`, country.id);
        } else {
          country.rebellionStrength = round2(country.rebellionStrength * 0.5);
        }
      }
    }

    return { tickAt: Date.now(), inventories, events };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    non_aggression: 'no agresión', free_trade: 'libre comercio', mutual_defense: 'defensa mutua',
    recon: 'reconocimiento', sabotage: 'sabotaje', heist: 'robo de CG', proxy: 'guerra proxy',
  };
  return map[kind] ?? kind;
}
