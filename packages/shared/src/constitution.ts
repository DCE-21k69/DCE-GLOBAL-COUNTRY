// ============================================================================
// @dce/shared — La Constitución (GDD §3.2).
// Metadatos para la UI y efectos numéricos aplicados por el motor de simulación.
// ============================================================================

import type { Constitution } from './types';

export type ConstitutionPillar =
  | 'government'
  | 'economy'
  | 'militaryDoctrine'
  | 'migrationPolicy';

export interface ConstitutionOption {
  value: string;
  label: string;
  /** Efectos positivos (buffs), según el GDD. */
  buffs: string[];
  /** Efectos negativos (debuffs), según el GDD. */
  debuffs: string[];
}

export const CONSTITUTION_OPTIONS: Record<ConstitutionPillar, ConstitutionOption[]> = {
  government: [
    {
      value: 'autocracy',
      label: 'Autocracia (Dictadura)',
      buffs: ['Órdenes instantáneas'],
      debuffs: ['+20% riesgo de revolución', 'Mayor cansancio ciudadano'],
    },
    {
      value: 'democracy',
      label: 'Democracia',
      buffs: ['+15% producción por felicidad', 'Atrae más inmigrantes'],
      debuffs: ['Decisiones requieren votación del Congreso (retraso)'],
    },
  ],
  economy: [
    {
      value: 'planned',
      label: 'Economía Planificada',
      buffs: ['+50% producción base', 'Control de precios'],
      debuffs: ['−60% ingresos de Crédito Global', 'Riesgo de hambruna'],
    },
    {
      value: 'free_market',
      label: 'Libre Mercado',
      buffs: ['+100% ingresos de CG vía impuestos'],
      debuffs: ['Ciudadanos ricos pueden financiar golpes de estado'],
    },
  ],
  militaryDoctrine: [
    {
      value: 'conscription',
      label: 'Servicio Obligatorio',
      buffs: ['Reclutamiento a mitad de coste'],
      debuffs: ['−10% producción económica'],
    },
    {
      value: 'professional',
      label: 'Ejército Profesional',
      buffs: ['+30% daño en combate'],
      debuffs: ['Salarios altos', 'Riesgo de deserción por impago'],
    },
  ],
  migrationPolicy: [
    {
      value: 'open_borders',
      label: 'Fronteras Abiertas',
      buffs: ['Crecimiento rápido de población'],
      debuffs: ['Riesgo de infiltración de espías'],
    },
    {
      value: 'closed_borders',
      label: 'Fronteras Cerradas',
      buffs: ['Seguridad absoluta'],
      debuffs: ['Crecimiento económico lento (falta de mano de obra)'],
    },
  ],
};

export const DEFAULT_CONSTITUTION: Constitution = {
  government: 'democracy',
  economy: 'free_market',
  militaryDoctrine: 'professional',
  migrationPolicy: 'open_borders',
};

export interface ConstitutionEffects {
  /** Multiplicador de la producción de recursos (Tier 1). */
  production: number;
  /** Multiplicador de los ingresos de Crédito Global (impuestos). */
  cgIncome: number;
}

/**
 * Efectos aplicados hoy por el motor (Sprint 3 v0). Los efectos de gobierno
 * (revolución/retraso), militar (daño/reclutamiento) y migración (espías,
 * crecimiento) se activarán cuando existan sus sistemas (Sprints 2, 4 y 5).
 */
export function constitutionEffects(c: Constitution): ConstitutionEffects {
  let production = 1;
  let cgIncome = 1;

  if (c.economy === 'planned') {
    production *= 1.5; // aumento drástico de producción base (GDD)
    cgIncome *= 0.4; // cero ingresos comerciales aproximado
  }
  if (c.economy === 'free_market') {
    cgIncome *= 2; // generación masiva de CG vía impuestos (GDD)
  }
  if (c.militaryDoctrine === 'conscription') {
    production *= 0.9; // la producción económica cae un 10% (GDD)
  }
  return { production, cgIncome };
}

/** Validación estructural de un objeto Constitution (para requests del cliente). */
export function isValidConstitution(c: unknown): c is Constitution {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    (o.government === 'autocracy' || o.government === 'democracy') &&
    (o.economy === 'planned' || o.economy === 'free_market') &&
    (o.militaryDoctrine === 'conscription' || o.militaryDoctrine === 'professional') &&
    (o.migrationPolicy === 'open_borders' || o.migrationPolicy === 'closed_borders')
  );
}
