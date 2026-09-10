import { describe, expect, it } from 'vitest';
import {
  hexCorners,
  hexDistance,
  hexKey,
  hexNeighbors,
  hexToPixel,
  parseHexKey,
  pixelToHex,
} from '../src/hex';
import { DEFAULT_SEED, generateWorld } from '../src/world';

describe('matemáticas hexagonales', () => {
  const ORIGIN = { q: 0, r: 0 };

  it('calcula distancias en hexágonos', () => {
    expect(hexDistance(ORIGIN, ORIGIN)).toBe(0);
    expect(hexDistance(ORIGIN, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance(ORIGIN, { q: -1, r: 1 })).toBe(1);
    expect(hexDistance(ORIGIN, { q: 2, r: 0 })).toBe(2);
    expect(hexDistance({ q: 1, r: -1 }, { q: -1, r: 1 })).toBe(2);
  });

  it('genera exactamente 6 vecinos únicos', () => {
    const neighbors = hexNeighbors(ORIGIN);
    expect(neighbors).toHaveLength(6);
    expect(new Set(neighbors.map(hexKey)).size).toBe(6);
    for (const n of neighbors) expect(hexDistance(ORIGIN, n)).toBe(1);
  });

  it('redondea el viaje píxel → hex → píxel', () => {
    const size = 20;
    for (const h of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -4, r: 5 },
      { q: 7, r: 7 },
    ]) {
      const p = hexToPixel(h.q, h.r, size);
      const back = pixelToHex(p.x, p.y, size);
      expect(back).toEqual(h);
    }
  });

  it('produce 6 vértices (12 valores) alrededor del centro', () => {
    const corners = hexCorners(0, 0, 10);
    expect(corners).toHaveLength(12);
    const center = hexToPixel(0, 0, 10);
    for (let i = 0; i < 12; i += 2) {
      const dx = corners[i]! - center.x;
      const dy = corners[i + 1]! - center.y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(10, 5);
    }
  });

  it('serializa y deserializa claves de hexágono', () => {
    expect(parseHexKey(hexKey({ q: -3, r: 12 }))).toEqual({ q: -3, r: 12 });
  });
});

describe('generación procedural del mundo', () => {
  it('es determinista: misma seed → mismo mundo', () => {
    const a = generateWorld(DEFAULT_SEED);
    const b = generateWorld(DEFAULT_SEED);
    expect(a).toEqual(b);
  });

  it('produce mundos distintos con seeds distintas', () => {
    const a = generateWorld('seed-a');
    const b = generateWorld('seed-b');
    expect(a.hexes).not.toEqual(b.hexes);
  });

  it('genera una masa coherente y sin duplicados', () => {
    const world = generateWorld(DEFAULT_SEED);
    expect(world.hexCount).toBeGreaterThan(200);
    const keys = world.hexes.map(hexKey);
    expect(new Set(keys).size).toBe(keys.length);
    // El centro siempre forma parte del mundo.
    expect(keys).toContain('0,0');
  });

  it('marca como costa los hexágonos fronterizos y de forma consistente', () => {
    const world = generateWorld(DEFAULT_SEED);
    const present = new Set(world.hexes.map(hexKey));
    for (const hex of world.hexes) {
      const touchesVoid = hexNeighbors(hex).some((n) => !present.has(hexKey(n)));
      expect(hex.isCoast).toBe(touchesVoid);
    }
  });

  it('asigna países demo con capitales y deja tierra libre en la frontera', () => {
    const world = generateWorld(DEFAULT_SEED);
    expect(world.countries).toHaveLength(4);
    const capitals = world.hexes.filter((h) => h.isCapital);
    expect(capitals).toHaveLength(4);
    const unclaimed = world.hexes.filter((h) => h.countryId === null);
    expect(unclaimed.length).toBeGreaterThan(0);
  });

  it('asigna recursos válidos por bioma', () => {
    const world = generateWorld(DEFAULT_SEED);
    for (const hex of world.hexes) {
      expect(hex.resources.length).toBeLessThanOrEqual(2);
      for (const r of hex.resources) {
        expect(['food', 'iron', 'coal', 'stone', 'oil']).toContain(r);
      }
    }
  });
});
