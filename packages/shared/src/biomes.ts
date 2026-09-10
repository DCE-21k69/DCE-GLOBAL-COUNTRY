// ============================================================================
// @dce/shared — Metadatos de biomas y recursos (una sola fuente de verdad
// para colores del mapa, etiquetas de la UI y futuras reglas del motor).
// ============================================================================

import type { Biome } from './types';

export const BIOME_LABELS: Record<Biome, string> = {
  plain: 'Llanura',
  forest: 'Bosque',
  mountain: 'Montaña',
  desert: 'Desierto',
  coast: 'Costa',
};

/** Colores base en 0xRRGGBB (Pixi Graphics). */
export const BIOME_COLORS: Record<Biome, number> = {
  plain: 0x4c8c52,
  forest: 0x2f6b3f,
  mountain: 0x7d8794,
  desert: 0xd6b265,
  coast: 0x58909c,
};

/** Factor de defensa del terreno (GDD §6.1: atacar montaña/bosque es más costoso). */
export const BIOME_DEFENSE: Record<Biome, number> = {
  plain: 0.2,
  forest: 0.75,
  mountain: 1,
  desert: 0.35,
  coast: 0.5,
};
