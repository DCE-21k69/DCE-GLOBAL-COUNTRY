// ============================================================================
// @dce/shared — Generador procedural del mundo (Alpha).
//
// Estrategia (GDD §2): el mundo es una masa continental finita que crece
// "orgánicamente" desde un centro, con núcleos secundarios que simulan
// penínsulas. Los bordes son tierra libre donde podrán fundarse naciones.
// El mismo código corre en el servidor (GET /api/world) y en el cliente
// como fallback offline: misma seed → mismo mapa (determinismo total).
// ============================================================================

import type { Biome, DemoCountry, Hex, ResourceType, WorldHex, WorldMap } from './types';
import { createRng, createValueNoise } from './rng';
import { HEX_DIRECTIONS, hexAdd, hexDistance, hexKey, hexNeighbors, parseHexKey } from './hex';

/** Seed por defecto del mundo Alpha. */
export const DEFAULT_SEED = 'dce-global-country-alpha';

/** Umbrales de elevación → bioma (de menor a mayor altura). */
const BIOME_BY_ELEVATION: ReadonlyArray<{ max: number; biome: Biome }> = [
  { max: -0.45, biome: 'desert' },
  { max: 0.18, biome: 'plain' },
  { max: 0.55, biome: 'forest' },
  { max: Number.POSITIVE_INFINITY, biome: 'mountain' },
];

/** Probabilidades de recursos Tier 1 por bioma (GDD §4.2). */
const RESOURCE_WEIGHTS: Record<Biome, ReadonlyArray<readonly [ResourceType, number]>> = {
  plain: [['food', 0.55], ['stone', 0.15]],
  forest: [['food', 0.45], ['coal', 0.3], ['stone', 0.1]],
  mountain: [['iron', 0.4], ['coal', 0.35], ['stone', 0.3]],
  desert: [['oil', 0.5], ['stone', 0.15]],
  coast: [['food', 0.7], ['oil', 0.2]],
};

export function generateWorld(seed: string = DEFAULT_SEED): WorldMap {
  const shapeRng = createRng('shape:' + seed);
  const heightNoise = createValueNoise('height:' + seed);
  const resourceRng = createRng('resources:' + seed);

  // ---- 1. Masa continental orgánica ---------------------------------------
  // Crecimiento BFS probabilístico desde el centro (grow) + núcleos
  // secundarios que forman penínsulas irregulares (GDD §2: "forma irregular").
  const hexSet = new Map<string, Hex>();
  hexSet.set(hexKey({ q: 0, r: 0 }), { q: 0, r: 0 });

  const grow = (origin: Hex, p: number, rounds: number) => {
    let frontier: Hex[] = [origin];
    for (let round = 0; round < rounds && frontier.length > 0; round++) {
      const next: Hex[] = [];
      for (const h of frontier) {
        for (const n of hexNeighbors(h)) {
          const k = hexKey(n);
          if (!hexSet.has(k) && shapeRng() < p) {
            hexSet.set(k, n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  };

  grow({ q: 0, r: 0 }, 0.64, 10);

  // Núcleos secundarios: caminatas aleatorias a distancia 6–8 del centro.
  const nuclei: Hex[] = [];
  const usedNuclei = new Set<string>();
  const nucleusCount = 4;
  for (let i = 0; i < nucleusCount; i++) {
    let walk: Hex = { q: 0, r: 0 };
    const steps = 6 + Math.floor(shapeRng() * 3);
    for (let s = 0; s < steps; s++) {
      walk = hexAdd(walk, HEX_DIRECTIONS[Math.floor(shapeRng() * 6)]!);
    }
    // Evitar capitales duplicadas desplazando una casilla.
    while (usedNuclei.has(hexKey(walk))) {
      walk = hexAdd(walk, HEX_DIRECTIONS[Math.floor(shapeRng() * 6)]!);
    }
    usedNuclei.add(hexKey(walk));
    nuclei.push(walk);
    grow(walk, 0.5, 5);
  }

  // ---- 2. Elevación, biomas, costa y recursos -----------------------------
  const rawHexes: WorldHex[] = [...hexSet.keys()].map((k) => {
    const h = parseHexKey(k);
    // Ruido anisotrópico suave (3 octavas) → elevación en [-1, 1].
    const noise = heightNoise.fbm(h.q * 0.35 + 7.31, h.r * 0.35 + 3.17, 3);
    const elevation = Math.max(-1, Math.min(1, (noise - 0.5) * 2.4));
    const isCoast = hexNeighbors(h).some((n) => !hexSet.has(hexKey(n)));

    let biome: Biome = 'plain';
    for (const tier of BIOME_BY_ELEVATION) {
      if (elevation <= tier.max) {
        biome = tier.biome;
        break;
      }
    }
    // La costa domina en el borde salvo montañas (acantilados).
    if (isCoast && biome !== 'mountain') biome = 'coast';

    const resources: ResourceType[] = [];
    for (const [res, p] of RESOURCE_WEIGHTS[biome]) {
      if (resourceRng() < p) resources.push(res);
    }
    // Máximo 2 recursos por hexágono (legibilidad del filtro Recursos).
    if (resources.length > 2) resources.length = 2;

    return {
      ...h,
      biome,
      elevation,
      isCoast,
      countryId: null,
      resources,
      isCapital: false,
    };
  });

  // ---- 3. Países de demostración (Voronoi por capital) --------------------
  const countries: DemoCountry[] = [
    { id: 'aurora', name: 'República de Aurora', color: '#4f9cf9', capital: nuclei[0]! },
    { id: 'vulcania', name: 'Vulcania', color: '#ef4444', capital: nuclei[1]! },
    { id: 'verdania', name: 'Confederación de Verdania', color: '#22c55e', capital: nuclei[2]! },
    { id: 'saharia', name: 'Emirato de Saharia', color: '#f59e0b', capital: nuclei[3]! },
  ];

  // Tierra libre: hexágonos lejos de toda capital (frontera de colonización).
  const CLAIM_RADIUS = 4.5;
  for (const hex of rawHexes) {
    let best: { id: string; dist: number } | null = null;
    for (const c of countries) {
      const dist = hexDistance(hex, c.capital);
      if (!best || dist < best.dist) best = { id: c.id, dist };
    }
    hex.countryId = best && best.dist <= CLAIM_RADIUS ? best.id : null;
  }
  for (const c of countries) {
    const capitalHex = rawHexes.find((h) => h.q === c.capital.q && h.r === c.capital.r);
    if (capitalHex) capitalHex.isCapital = true;
  }

  // Orden determinista para salida estable (tests, cachés, diffs).
  rawHexes.sort((a, b) => (a.q - b.q) || (a.r - b.r));

  return {
    seed,
    hexCount: rawHexes.length,
    hexes: rawHexes,
    countries,
  };
}
