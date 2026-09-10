// ============================================================================
// @dce/shared — Matemáticas de cuadrícula hexagonal (coordenadas axiales).
//
// Convención: orientación "pointy-top" (vértice arriba), flat array de píxeles.
// Toda la teoría está explicada en docs/04-frontend-mapa-hexagonal.md.
// ============================================================================

import type { Hex } from './types';

export const SQRT3 = Math.sqrt(3);

/** Las 6 direcciones vecinas en coordenadas axiales (pointy-top). */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** Clave canónica de un hexágono para Map/Set (evita comparar objetos). */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return { q: q!, r: r! };
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d));
}

/** Distancia en hexágonos entre dos celdas (usando coordenadas cúbicas). */
export function hexDistance(a: Hex, b: Hex): number {
  const ax = a.q;
  const az = a.r;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

/** Redondeo a coordenadas cúbicas enteras (necesario para pixel → hex). */
export function cubeRound(x: number, y: number, z: number): Hex {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { q: rx, r: rz };
}

/**
 * Coordenadas axiales → centro del hexágono en píxeles (pointy-top).
 *   x = size * (√3·q + √3/2·r)
 *   y = size * (3/2·r)
 */
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (SQRT3 * q + (SQRT3 / 2) * r),
    y: size * (1.5 * r),
  };
}

/**
 * Píxel → hexágono axial (pointy-top), con redondeo cúbico para precisión.
 *   q = (√3/3·x − 1/3·y) / size
 *   r = (2/3·y) / size
 */
export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return cubeRound(q, -q - r, r);
}

/**
 * Vértices del hexágono como array plano [x0, y0, x1, y1, ...],
 * listo para `Graphics.poly(...).fill(...)` de Pixi.js.
 */
export function hexCorners(q: number, r: number, size: number): number[] {
  const c = hexToPixel(q, r, size);
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: vértices a 60°·i − 30°, empezando arriba a la derecha.
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(c.x + size * Math.cos(angle), c.y + size * Math.sin(angle));
  }
  return points;
}
