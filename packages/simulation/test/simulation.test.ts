import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONSTITUTION,
  generateWorld,
  hexKey,
  hexNeighbors,
  type Constitution,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';
import {
  MAX_INITIAL_HEXES,
  MIN_INITIAL_HEXES,
  SimError,
  Simulation,
} from '../src/simulation';

/** Construye un mundo artificial: un blob libre rodeado por un anillo reclamado. */
function makePocketWorld(): WorldMap {
  const hexes: WorldHex[] = [];
  const free = new Set(['0,0', '1,0', '0,1']);
  // Anillo de hexágonos alrededor de (0,0) radio 2, todos reclamados por 'npca'.
  const center = { q: 0, r: 0 };
  const seen = new Set<string>();
  const queue = [center];
  while (queue.length > 0) {
    const h = queue.shift()!;
    const k = hexKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    const isFree = free.has(k);
    hexes.push({
      q: h.q,
      r: h.r,
      biome: 'plain',
      elevation: 0,
      isCoast: false,
      countryId: isFree ? null : 'npca',
      resources: [],
      isCapital: false,
    });
    if (Math.abs(h.q) <= 2 && Math.abs(h.r) <= 2 && Math.abs(-h.q - h.r) <= 2) {
      for (const n of hexNeighbors(h)) queue.push(n);
    }
  }
  return {
    seed: 'pocket-test',
    hexCount: hexes.length,
    hexes,
    countries: [{ id: 'npca', name: 'Nación Anillo', color: '#111111', capital: { q: -2, r: 0 } }],
  };
}

/**
 * Busca un hexágono libre perteneciente a una componente conexa de tierra
 * libre con al menos MIN_INITIAL_HEXES hexágonos (frontera colonizable).
 */
function findFreeFrontierHex(world: WorldMap): WorldHex {
  const free = world.hexes.filter((h) => h.countryId === null);
  const freeSet = new Set(free.map((h) => hexKey(h)));
  const visited = new Set<string>();
  for (const start of free) {
    const k = hexKey(start);
    if (visited.has(k)) continue;
    const component: WorldHex[] = [];
    const queue = [start];
    visited.add(k);
    while (queue.length > 0) {
      const h = queue.shift()!;
      component.push(h);
      for (const n of hexNeighbors(h)) {
        const nk = hexKey(n);
        if (freeSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(world.hexes.find((x) => hexKey(x) === nk)!);
        }
      }
    }
    if (component.length >= MIN_INITIAL_HEXES) {
      // Preferir un hexágono de costa real (borde del mundo).
      return component.find((h) => h.isCoast) ?? component[0]!;
    }
  }
  throw new Error('test: no hay tierra libre colonizable');
}

describe('Simulation — fundación de naciones', () => {
  const world = generateWorld();

  it('arranca con los países NPC del generador y sus territorios', () => {
    const sim = new Simulation(world);
    expect(sim.listCountries().length).toBe(world.countries.length);
    for (const c of sim.listCountries()) {
      expect(sim.ownedHexes(c.id).length).toBeGreaterThan(0);
    }
  });

  it('funda un país en la frontera con 10-15 hexágonos irregulares', () => {
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());
    const { country, claimed } = sim.foundCountry({
      name: 'Testlandia',
      color: '#123456',
      constitution: DEFAULT_CONSTITUTION,
      foundedBy: 'user-1',
      hex,
    });

    expect(claimed.length).toBeGreaterThanOrEqual(MIN_INITIAL_HEXES);
    expect(claimed.length).toBeLessThanOrEqual(MAX_INITIAL_HEXES);
    expect(country.population).toBe(100);

    const w2 = sim.getWorld();
    expect(w2.countries.map((c) => c.name)).toContain('Testlandia');
    const owned = w2.hexes.filter((h) => h.countryId === country.id);
    expect(owned.length).toBe(claimed.length);
    const capital = w2.hexes.find((h) => hexKey(h) === hexKey(hex));
    expect(capital?.isCapital).toBe(true);
  });

  it('rechaza fundar sobre territorio ajeno', () => {
    const sim = new Simulation(world);
    const claimedHex = sim.getWorld().hexes.find((h) => h.countryId !== null)!;
    expect(() =>
      sim.foundCountry({
        name: 'Invasores',
        color: '#654321',
        constitution: DEFAULT_CONSTITUTION,
        foundedBy: 'u2',
        hex: claimedHex,
      }),
    ).toThrowError(SimError);
  });

  it('rechaza fundar en un bolsillo interior sin tierra suficiente', () => {
    const sim = new Simulation(makePocketWorld());
    expect(() =>
      sim.foundCountry({
        name: 'Atrapados',
        color: '#abcdef',
        constitution: DEFAULT_CONSTITUTION,
        foundedBy: 'u3',
        hex: { q: 0, r: 0 },
      }),
    ).toThrowError(/tierra libre/);
  });

  it('valida nombre, color y constitución', () => {
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());
    expect(() =>
      sim.foundCountry({ name: 'X', color: '#123456', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u', hex }),
    ).toThrowError(/nombre/);
    expect(() =>
      sim.foundCountry({ name: 'Valido', color: 'rojo', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u', hex }),
    ).toThrowError(/color/);
    expect(() =>
      sim.foundCountry({ name: 'Valido', color: '#123456', constitution: { nope: true }, foundedBy: 'u', hex }),
    ).toThrowError(/Constitución/);
  });

  it('no permite nombres duplicados (case-insensitive)', () => {
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());
    sim.foundCountry({ name: 'Potencia', color: '#112233', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u', hex });
    const hex2 = findFreeFrontierHex(sim.getWorld());
    expect(() =>
      sim.foundCountry({ name: 'potencia', color: '#332211', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u2', hex: hex2 }),
    ).toThrowError(/existe/);
  });
});

describe('Simulation — Tick económico', () => {
  const planned: Constitution = { ...DEFAULT_CONSTITUTION, economy: 'planned', militaryDoctrine: 'conscription' };
  const freeMarket: Constitution = { ...DEFAULT_CONSTITUTION, economy: 'free_market' };

  it('produce recursos según biomas y aplica los efectos de la Constitución', () => {
    const world = generateWorld();
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());

    const { country: cA } = sim.foundCountry({
      name: 'Planificada',
      color: '#aa0000',
      constitution: planned,
      foundedBy: 'u',
      hex,
    });
    const hexB = findFreeFrontierHex(sim.getWorld());
    const { country: cB } = sim.foundCountry({
      name: 'Mercado',
      color: '#00aa00',
      constitution: freeMarket,
      foundedBy: 'u2',
      hex: hexB,
    });

    // Forzar recursos idénticos para comparar solo el efecto constitucional.
    const invA0 = { ...sim.getInventories(cA.id)! };
    const invB0 = { ...sim.getInventories(cB.id)! };

    const result = sim.tick();
    const invA = result.inventories.get(cA.id)!;
    const invB = result.inventories.get(cB.id)!;

    // La planificada (+50% producción, −10% conscripción, −60% CG) produce más
    // comida que la de libre mercado, pero gana mucho menos CG.
    const foodA = invA.food! - invA0.food!;
    const foodB = invB.food! - invB0.food!;
    expect(foodA).toBeGreaterThan(foodB);
    expect(invA.cg!).toBeLessThan(invB.cg!);
  });

  it('descuenta la comida que consume la población (GDD §5)', () => {
    const world = generateWorld();
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());
    const { country } = sim.foundCountry({
      name: 'Hambrienta',
      color: '#123123',
      constitution: DEFAULT_CONSTITUTION,
      foundedBy: 'u',
      hex,
    });
    const before = sim.getInventories(country.id)!.food!;
    const r = sim.tick();
    const after = r.inventories.get(country.id)!.food!;
    // Sin producción de comida (sin granjas) la comida bajaría 100; con granjas
    // sube o baja según terreno, pero siempre se ha aplicado el consumo.
    expect(after).not.toBe(before);
  });

  it('emite evento de hambruna cuando la comida llega a cero', () => {
    const world = generateWorld();
    const sim = new Simulation(world);
    const hex = findFreeFrontierHex(sim.getWorld());
    const { country } = sim.foundCountry({
      name: 'SinComida',
      color: '#123123',
      constitution: planned,
      foundedBy: 'u',
      hex,
    });
    // Vaciar la despensa: sin comida inicial y sin recursos food no alcanza.
    const owned = sim.ownedHexes(country.id);
    for (const h of owned) h.resources = h.resources.filter((r) => r !== 'food');
    sim.setInventories(country.id, { cg: 0, food: 0, iron: 0, coal: 0, stone: 0, oil: 0 });

    let famine = false;
    for (let i = 0; i < 3; i++) {
      const r = sim.tick();
      if (r.events.some((e) => e.type === 'famine' && e.countryId === country.id)) famine = true;
    }
    expect(famine).toBe(true);
  });
});
