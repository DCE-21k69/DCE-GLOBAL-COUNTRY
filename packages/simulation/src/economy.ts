// ============================================================================
// @dce/simulation — Reglas económicas del Tick (GDD §4).
// Números de balance v0: editables aquí sin tocar el motor.
// ============================================================================

import type { ResourceType } from '@dce/shared';

/** Producción base por recurso y por hexágono con ese recurso, por Tick. */
export const PRODUCTION_PER_RESOURCE: Record<ResourceType, number> = {
  food: 120,
  iron: 60,
  coal: 60,
  stone: 40,
  oil: 80,
};

/** Consumo de comida por ciudadano y por Tick (GDD §5: necesidades básicas). */
export const FOOD_PER_CITIZEN_PER_TICK = 1;

/** Ingreso base de Crédito Global por ciudadano y por Tick (impuestos). */
export const CG_TAX_PER_CITIZEN_PER_TICK = 2;

/** Población inicial de una nación recién fundada. */
export const START_POPULATION = 100;

/** Reservas iniciales de una nación recién fundada. */
export const START_INVENTORIES: Record<string, number> = {
  cg: 5000,
  food: 600,
  iron: 0,
  coal: 0,
  stone: 40,
  oil: 0,
};

export const RESOURCE_KEYS: readonly string[] = ['cg', 'food', 'iron', 'coal', 'stone', 'oil'];

export function emptyInventories(): Record<string, number> {
  return { ...START_INVENTORIES };
}
