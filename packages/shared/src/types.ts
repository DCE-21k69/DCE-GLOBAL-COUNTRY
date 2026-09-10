// ============================================================================
// @dce/shared — Tipos de dominio compartidos entre cliente y servidor.
// Fuente de verdad única: cualquier cambio aquí se propaga a ambos lados.
// ============================================================================

/** Biomas del mundo (GDD §2). El bioma dicta las materias primas Tier 1 disponibles. */
export type Biome = 'plain' | 'forest' | 'mountain' | 'desert' | 'coast';

/** Materias primas Tier 1 (GDD §4.2). */
export type ResourceType = 'food' | 'iron' | 'coal' | 'stone' | 'oil';

/**
 * Coordenadas axiales de un hexágono (ver docs/04-frontend-mapa-hexagonal.md).
 * q = columna, r = fila. La tercera coordenada (s) se deriva: s = -q - r.
 */
export interface Hex {
  q: number;
  r: number;
}

/** Un hexágono del mundo con su estado derivado (procedural en el Alpha). */
export interface WorldHex extends Hex {
  biome: Biome;
  /** Elevación normalizada en [-1, 1], usada para biomas y defensa militar. */
  elevation: number;
  /** true si tiene al menos un vecino fuera del mapa (frontera del mundo). */
  isCoast: boolean;
  /** País propietario, o null si es tierra libre (donde se fundan naciones nuevas). */
  countryId: string | null;
  resources: ResourceType[];
  isCapital: boolean;
}

/** País de demostración generado proceduralmente (será reemplazado por la tabla `countries`). */
export interface DemoCountry {
  id: string;
  name: string;
  /** Color CSS en formato '#rrggbb'. */
  color: string;
  capital: Hex;
}

/** Respuesta del endpoint /api/world: el estado completo del mapa. */
export interface WorldMap {
  seed: string;
  hexCount: number;
  hexes: WorldHex[];
  countries: DemoCountry[];
}

/** Filtros de visualización del mapa (GDD §7). */
export type MapFilter = 'politics' | 'resources' | 'military';

/** Roles que puede asumir un ciudadano (GDD §5). */
export type CitizenRole = 'worker' | 'entrepreneur' | 'soldier' | 'minister';

/** Pilares de la Constitución (GDD §3.2). */
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
