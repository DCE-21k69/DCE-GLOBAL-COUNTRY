// ============================================================================
// @dce/shared — Definiciones de juego: edificios, unidades, mercado y banderas.
// Una sola fuente de verdad para el motor, la API y la UI del cliente.
// ============================================================================

import type { AnyResource, FlagLayers, UnitType } from './types';

// ── Recursos ───────────────────────────────────────────────────────────────

export const RESOURCE_LABELS: Record<AnyResource, string> = {
  cg: 'Crédito Global (CG)',
  food: 'Comida',
  iron: 'Hierro',
  coal: 'Carbón',
  stone: 'Piedra',
  oil: 'Petróleo',
  steel: 'Acero',
  fuel: 'Combustible',
  arms: 'Armamento',
  goods: 'Bienes de consumo',
};

export const RESOURCE_ICONS: Record<AnyResource, string> = {
  cg: '💰',
  food: '🌾',
  iron: '⛏️',
  coal: '⬛',
  stone: '🧱',
  oil: '🛢️',
  steel: '🏗️',
  fuel: '⛽',
  arms: '🔫',
  goods: '🛍️',
};

// ── Edificios (GDD §4.2) ──────────────────────────────────────────────────

export interface BuildingDef {
  type: string;
  label: string;
  tier: 1 | 2 | 3;
  cost: Partial<Record<AnyResource, number>>;
  input?: Partial<Record<AnyResource, number>>;
  output?: Partial<Record<AnyResource, number>>;
  /** Producción por unidad de recurso presente en el hex (minas/pozos). */
  perResource?: Partial<Record<AnyResource, number>>;
  /** Requiere que el hex tenga este recurso. */
  requiresResource?: AnyResource;
  /** El edificio produce un +50% si el hex tiene este recurso. */
  bonusResource?: AnyResource;
}

export const BUILDING_DEFS: Record<string, BuildingDef> = {
  farm: {
    type: 'farm', label: 'Granja', tier: 1,
    cost: { cg: 200, stone: 20 }, output: { food: 150 }, bonusResource: 'food',
  },
  mine: {
    type: 'mine', label: 'Mina', tier: 1,
    cost: { cg: 250, stone: 30 },
    perResource: { iron: 40, coal: 40, stone: 25 },
    requiresResource: 'iron', // acepta iron/coal/stone
  },
  well: {
    type: 'well', label: 'Pozo de Petróleo', tier: 1,
    cost: { cg: 300, stone: 30 },
    perResource: { oil: 50 }, requiresResource: 'oil',
  },
  foundry: {
    type: 'foundry', label: 'Fundición', tier: 2,
    cost: { cg: 600, iron: 60, stone: 40 },
    input: { iron: 30, coal: 20 }, output: { steel: 25 },
  },
  refinery: {
    type: 'refinery', label: 'Refinería', tier: 2,
    cost: { cg: 700, iron: 40, stone: 40 },
    input: { oil: 30 }, output: { fuel: 20 },
  },
  arms_factory: {
    type: 'arms_factory', label: 'Fábrica de Armamento', tier: 3,
    cost: { cg: 1500, steel: 40, stone: 60 },
    input: { steel: 20, fuel: 10 }, output: { arms: 10 },
  },
  consumer_industry: {
    type: 'consumer_industry', label: 'Industria de Consumo', tier: 3,
    cost: { cg: 1200, steel: 30, stone: 60 },
    input: { steel: 10, fuel: 10 }, output: { goods: 20 },
  },
};

/** Bonificación de producción por trabajador asignado (máx. +50%). */
export const WORKER_BONUS_PER_WORKER = 0.08;
export const MAX_WORKER_BONUS = 0.5;

// ── Unidades militares (GDD §6.1) ─────────────────────────────────────────

export interface UnitDef {
  type: UnitType;
  label: string;
  costCg: number;
  costRes: Partial<Record<AnyResource, number>>;
  soldiers: number;
  power: number;
  defense: number;
  occupies: boolean;
  siege: boolean;
  /** Multiplicador de daño contra cada tipo enemigo. */
  vs: Record<UnitType, number>;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  infantry: {
    type: 'infantry', label: 'Infantería', costCg: 300, costRes: { iron: 30 },
    soldiers: 50, power: 10, defense: 14, occupies: true, siege: false,
    vs: { infantry: 1, tank: 0.8, artillery: 1.5 },
  },
  tank: {
    type: 'tank', label: 'Tanques', costCg: 1000, costRes: { steel: 60 },
    soldiers: 50, power: 18, defense: 16, occupies: false, siege: false,
    vs: { infantry: 1.4, tank: 1, artillery: 0.9 },
  },
  artillery: {
    type: 'artillery', label: 'Artillería', costCg: 1200, costRes: { steel: 40 },
    soldiers: 50, power: 14, defense: 8, occupies: false, siege: true,
    vs: { infantry: 0.8, tank: 1.3, artillery: 1 },
  },
};

/** Bonificación del ejército profesional: +30% daño (GDD §3.2). */
export const PROFESSIONAL_DAMAGE_BONUS = 1.3;
/** Servicio obligatorio: reclutamiento a mitad de coste (GDD §3.2). */
export const CONSCRIPTION_COST_MULTIPLIER = 0.5;

// ── Mercado (GDD §4.1) ────────────────────────────────────────────────────

export const MARKET_BASE_PRICES: Record<AnyResource, number> = {
  cg: 1,
  food: 5,
  iron: 12,
  coal: 8,
  stone: 6,
  oil:20,
  steel: 40,
  fuel: 55,
  arms: 120,
  goods: 50,
};

export const MARKET_SPREAD = 0.05; // comprar = precio×1.05, vender = ×0.95
export const BLACK_MARKET_MULTIPLIER = 2.2; // precios inflados (GDD §6.2)
export const BLACK_MARKET_PARIAH_MULTIPLIER = 1.8;

export const CG_LABELS: Record<string, string> = {
  stable: 'Estable',
  crisis: 'Crisis (inflación)',
  deflation: 'Deflación',
  trade_war: 'Guerra comercial',
};

// ── Banderas (creador por capas → SVG determinista, GDD §3.1) ─────────────

export const FLAG_EMBLEM_PATHS: Record<string, string> = {
  star: 'M50 12 L58 38 L86 38 L63 54 L71 80 L50 64 L29 80 L37 54 L14 38 L42 38 Z',
  moon: 'M62 8 A30 30 0 1 0 62 92 A22 22 0 1 1 62 8 Z',
  swords: 'M30 30 L42 42 M70 30 L58 42 M50 38 L46 62 L54 62 Z M50 20 L44 38 L56 38 Z',
  eagle: 'M50 20 L62 40 L78 36 L66 52 L72 70 L50 62 L28 70 L34 52 L22 36 L38 40 Z',
  anchor: 'M50 18 A10 10 0 1 1 49.9 18 M50 28 L50 78 M38 58 A14 14 0 0 0 62 58 M34 70 L66 70 M34 52 L66 52',
  wheat: 'M50 82 C44 62 30 52 22 30 C38 36 46 44 50 52 C54 44 62 36 78 30 C70 52 56 62 50 82 Z M50 30 L50 60',
  sun: 'M50 30 A20 20 0 1 1 49.9 30 M50 2 L50 12 M50 88 L50 98 M2 50 L12 50 M88 50 L98 50 M16 16 L23 23 M77 77 L84 84 M84 16 L77 23 M23 77 L16 84',
};

export const FLAG_EMBLEM_LABELS: Record<string, string> = {
  none: 'Sin emblema',
  star: 'Estrella',
  moon: 'Luna creciente',
  swords: 'Espadas',
  eagle: 'Águila',
  anchor: 'Ancla',
  wheat: 'Espigas',
  sun: 'Sol',
};

export function renderFlagSvg(layers: FlagLayers): string {
  const { pattern, colorA, colorB, emblem, emblemColor } = layers;
  let body: string;
  if (pattern === 'solid') {
    body = `<rect width="100" height="60" fill="${colorA}"/>`;
  } else if (pattern === 'stripes') {
    body =
      `<rect width="100" height="60" fill="${colorA}"/>` +
      `<rect y="0" width="33.4" height="60" fill="${colorB}"/>` +
      `<rect x="66.6" width="33.4" height="60" fill="${colorB}"/>`;
  } else {
    body =
      `<rect width="100" height="60" fill="${colorA}"/>` +
      `<rect x="40" width="20" height="60" fill="${colorB}"/>` +
      `<rect y="20" width="100" height="20" fill="${colorB}"/>`;
  }
  const emblemSvg =
    emblem !== 'none' && FLAG_EMBLEM_PATHS[emblem]
      ? `<g transform="translate(0,0) scale(0.5) translate(50,30)"><path d="${FLAG_EMBLEM_PATHS[emblem]}" fill="${emblemColor}" stroke="rgba(0,0,0,0.35)" stroke-width="2"/></g>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" width="120" height="72">${body}${emblemSvg}</svg>`;
}

export const DEFAULT_FLAG_LAYERS: FlagLayers = {
  pattern: 'stripes',
  colorA: '#0f2a4a',
  colorB: '#38bdf8',
  emblem: 'star',
  emblemColor: '#f5c14e',
};
