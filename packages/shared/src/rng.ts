// ============================================================================
// @dce/shared — Generación de números aleatorios determinista.
//
// La generación procedural DEBE ser determinista (misma seed → mismo mundo):
// así el servidor es la autoridad del mapa y el cliente puede renderizarlo
// offline como fallback sin desincronizarse jamás.
// ============================================================================

/** Hash de cadena a entero de 32 bits (xmur3). */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * PRNG mulberry32: rápido, determinista y suficiente para generación
 * de terreno. Devuelve floats uniformes en [0, 1).
 */
export function createRng(seed: string | number): () => number {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return function mulberry32() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ruido de valor 2D determinista (lattice hash + interpolación smoothstep)
 * con fractal brownian motion para terrenos orgánicos.
 */
export function createValueNoise(seed: string) {
  const rand = createRng('noise:' + seed);
  const lattice = new Float64Array(256 * 256);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  const ix = (v: number) => ((v % 256) + 256) % 256;
  const at = (x: number, y: number) => lattice[ix(x) * 256 + ix(y)]!;

  function noise2(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx); // smoothstep
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = at(x0, y0);
    const v10 = at(x0 + 1, y0);
    const v01 = at(x0, y0 + 1);
    const v11 = at(x0 + 1, y0 + 1);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy; // [0, 1]
  }

  /** Fractal Brownian Motion: suma de octavas con amplitud decreciente. */
  function fbm(x: number, y: number, octaves = 3): number {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      total += amplitude * noise2(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / norm; // [0, 1]
  }

  return { noise2, fbm };
}
