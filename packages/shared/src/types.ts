// ============================================================================
// @dce/shared — Tipos de dominio compartidos entre cliente y servidor (v1.0).
// ============================================================================

/** Biomas del mundo (GDD §2). */
export type Biome = 'plain' | 'forest' | 'mountain' | 'desert' | 'coast';

/** Materias primas Tier 1 (GDD §4.2). */
export type ResourceType = 'food' | 'iron' | 'coal' | 'stone' | 'oil';
/** Materiales refinados Tier 2 y manufactura Tier 3 + dinero. */
export type AdvancedResource = 'cg' | 'steel' | 'fuel' | 'arms' | 'goods';
export type AnyResource = ResourceType | AdvancedResource;

export interface Hex {
  q: number;
  r: number;
}

export interface WorldHex extends Hex {
  biome: Biome;
  elevation: number;
  isCoast: boolean;
  countryId: string | null;
  resources: ResourceType[];
  isCapital: boolean;
}

export interface DemoCountry {
  id: string;
  name: string;
  color: string;
  capital: Hex;
  npc?: boolean;
}

export type CitizenRole = 'worker' | 'soldier' | 'minister';

export type GovernmentType = 'autocracy' | 'democracy';
export type EconomyType = 'planned' | 'free_market';
export type MilitaryDoctrine = 'conscription' | 'professional';
export type MigrationPolicy = 'open_borders' | 'closed_borders';

export interface Constitution {
  government: GovernmentType;
  economy: EconomyType;
  militaryDoctrine: MilitaryDoctrine;
  migrationPolicy: MigrationPolicy;
}

// ── Banderas (creador de banderas, GDD §3.1) ───────────────────────────────

export type FlagPattern = 'solid' | 'stripes' | 'cross';
export type FlagEmblem = 'none' | 'star' | 'moon' | 'swords' | 'eagle' | 'anchor' | 'wheat' | 'sun';

export interface FlagLayers {
  pattern: FlagPattern;
  colorA: string; // #rrggbb
  colorB: string; // #rrggbb (ignorada en solid)
  emblem: FlagEmblem;
  emblemColor: string;
}

// ── Ciudadanos, edificios, ejércitos (GDD §5, §4.2, §6.1) ─────────────────

export interface Citizen {
  userId: string;
  username: string;
  countryId: string;
  role: CitizenRole;
  assignedBuildingId: string | null;
  joinedAt: string;
}

export type BuildingType =
  | 'farm'
  | 'mine'
  | 'well'
  | 'foundry'
  | 'refinery'
  | 'arms_factory'
  | 'consumer_industry';

export interface Building {
  id: string;
  countryId: string;
  hex: Hex;
  type: BuildingType;
  tier: 1 | 2 | 3;
  level: number;
  workers: number;
}

export type UnitType = 'infantry' | 'tank' | 'artillery';

export interface Army {
  id: string;
  countryId: string;
  unitType: UnitType;
  soldiers: number;
  hex: Hex;
  supply: boolean;
  lastMovedTick: number;
}

// ── Diplomacia y guerra (GDD §6) ──────────────────────────────────────────

export type TreatyKind = 'non_aggression' | 'free_trade' | 'mutual_defense';

export interface Treaty {
  id: string;
  a: string;
  b: string;
  kind: TreatyKind;
  createdAt: string;
}

export interface War {
  id: string;
  aggressorId: string;
  defenderId: string;
  status: 'active' | 'ended';
  capturedHexes: Hex[];
  winnerId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export type ProposalKind = 'embargo' | 'tax';

export interface Proposal {
  id: string;
  proposerId: string;
  kind: ProposalKind;
  targetCountryId: string | null; // embargo
  taxPercent: number; // tax
  votes: Record<string, 'yes' | 'no' | 'abstain'>;
  status: 'open' | 'passed' | 'rejected';
  closesAt: number;
}

export type MissionKind = 'recon' | 'sabotage' | 'heist' | 'proxy';

export interface EspionageMission {
  id: string;
  spyCountryId: string;
  targetCountryId: string;
  kind: MissionKind;
  status: 'pending' | 'success' | 'failed';
  result: string | null;
  createdAt: string;
}

// ── Economía (GDD §4) ─────────────────────────────────────────────────────

export type CgState = 'stable' | 'crisis' | 'deflation' | 'trade_war';

export interface MarketQuote {
  resource: AnyResource;
  buy: number; // lo que pagas por comprar 1 unidad
  sell: number; // lo que recibes por vender 1 unidad
}

export interface NewsEvent {
  id: string;
  at: number;
  kind: string;
  message: string;
  countryId: string | null;
}

// ── País persistente ──────────────────────────────────────────────────────

export interface CountryMeta {
  id: string;
  name: string;
  color: string;
  foundedBy: string | null;
  capital: Hex;
  constitution: Constitution;
  population: number;
  createdAt: string;
  /** Perfil público (Wiki Nacional, GDD §3.1). */
  wikiHistory: string;
  wikiMotto: string;
  flagSvg: string;
  /** Estado económico-político vivo. */
  happiness: number;
  salary: number;
  currencyCode: string;
  gdp: number;
  rebellionStrength: number;
  isPariah: boolean;
  isPuppetOf: string | null;
  /** true si es NPC del mundo base (no fundada por jugador). */
  npc: boolean;
}

export interface WorldMap {
  seed: string;
  hexCount: number;
  hexes: WorldHex[];
  countries: DemoCountry[];
}

export type MapFilter = 'politics' | 'resources' | 'military';

// ── Estado persistido (snapshot del motor) ────────────────────────────────

export interface PersistedState {
  countries: CountryMeta[];
  /** "q,r" → countryId (propiedad de TODO el territorio, incluye NPC). */
  ownership: Record<string, string>;
  inventories: Record<string, Record<string, number>>;
  buildings: Building[];
  citizenships: Citizen[];
  armies: Army[];
  treaties: Treaty[];
  wars: War[];
  proposals: Proposal[];
  missions: EspionageMission[];
}
