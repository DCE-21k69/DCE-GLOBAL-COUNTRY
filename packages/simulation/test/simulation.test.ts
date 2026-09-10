import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONSTITUTION,
  generateWorld,
  hexDistance,
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

function newSim(world: WorldMap, seed = 'test') {
  return new Simulation(seed, world);
}

/** Construye un mundo artificial: bolsillo libre rodeado por un anillo reclamado. */
function makePocketWorld(): WorldMap {
  const hexes: WorldHex[] = [];
  const free = new Set(['0,0', '1,0', '0,1']);
  const center = { q: 0, r: 0 };
  const seen = new Set<string>();
  const queue = [center];
  while (queue.length > 0) {
    const h = queue.shift()!;
    const k = hexKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    hexes.push({
      q: h.q, r: h.r, biome: 'plain', elevation: 0, isCoast: false,
      countryId: free.has(k) ? null : 'npca', resources: [], isCapital: false,
    });
    if (Math.abs(h.q) <= 2 && Math.abs(h.r) <= 2 && Math.abs(-h.q - h.r) <= 2) {
      for (const n of hexNeighbors(h)) queue.push(n);
    }
  }
  return {
    seed: 'pocket-test', hexCount: hexes.length, hexes,
    countries: [{ id: 'npca', name: 'Nación Anillo', color: '#111111', capital: { q: -2, r: 0 } }],
  };
}

/** Busca un hexágono libre de una componente conexa con ≥10 hexágonos. */
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
    if (component.length >= MIN_INITIAL_HEXES) return component.find((h) => h.isCoast) ?? component[0]!;
  }
  throw new Error('test: no hay tierra libre colonizable');
}

function foundA(sim: Simulation, name = 'Testlandia', constitution: Constitution = DEFAULT_CONSTITUTION) {
  const hex = findFreeFrontierHex(sim.getWorld());
  return sim.foundCountry({ name, color: '#123456', constitution, foundedBy: 'u-' + name, hex });
}

describe('fundación de naciones (v0.2 regresión)', () => {
  const world = generateWorld();

  it('arranca con los NPC y funda en la frontera con 10-15 hexes', () => {
    const sim = newSim(world);
    expect(sim.listCountries().length).toBe(world.countries.length);
    const { country, claimed } = foundA(sim);
    expect(claimed.length).toBeGreaterThanOrEqual(MIN_INITIAL_HEXES);
    expect(claimed.length).toBeLessThanOrEqual(MAX_INITIAL_HEXES);
    expect(country.population).toBe(100);
    expect(sim.getWorld().countries.map((c) => c.name)).toContain('Testlandia');
  });

  it('rechaza territorio ajeno, bolsillos y entradas inválidas', () => {
    const sim = newSim(world);
    const claimedHex = sim.getWorld().hexes.find((h) => h.countryId !== null)!;
    expect(() =>
      sim.foundCountry({ name: 'Invasores', color: '#654321', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u2', hex: claimedHex }),
    ).toThrowError(SimError);
    expect(() => newSim(makePocketWorld()).foundCountry({
      name: 'Atrapados', color: '#abcdef', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u3', hex: { q: 0, r: 0 },
    })).toThrowError(/tierra libre/);
    const hex = findFreeFrontierHex(sim.getWorld());
    expect(() =>
      sim.foundCountry({ name: 'X', color: '#123456', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u', hex }),
    ).toThrowError(/nombre/);
  });

  it('no permite nombres duplicados', () => {
    const sim = newSim(world);
    foundA(sim, 'Potencia');
    const hex2 = findFreeFrontierHex(sim.getWorld());
    expect(() =>
      sim.foundCountry({ name: 'potencia', color: '#332211', constitution: DEFAULT_CONSTITUTION, foundedBy: 'u2', hex: hex2 }),
    ).toThrowError(/existe/);
  });
});

describe('ciudadanía, edificios y trabajo', () => {
  it('permite unirse, trabajar y emigrar', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim);
    sim.joinCountry('user-9', 'peon', country.id);
    expect(sim.myCitizenship('user-9')!.countryId).toBe(country.id);

    // Construir una granja en territorio propio.
    const owned = sim.ownedHexes(country.id);
    const farm = sim.build(country.id, 'farm', owned[0]!);
    sim.assignWork('user-9', farm.id);
    expect(sim.buildingsOf(country.id)[0]!.workers).toBe(1);

    sim.leaveCountry('user-9');
    expect(sim.myCitizenship('user-9')).toBeNull();
    expect(sim.buildingsOf(country.id)[0]!.workers).toBe(0);
  });

  it('valida costes y requisitos de construcción', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim);
    const owned = sim.ownedHexes(country.id);
    sim.setInventories(country.id, { cg: 0, food: 0, iron: 0, coal: 0, stone: 0, oil: 0 });
    expect(() => sim.build(country.id, 'farm', owned[0]!)).toThrowError(/insuficientes/);

    // El pozo requiere petróleo en el hexágono.
    sim.setInventories(country.id, { cg: 9999, food: 0, iron: 0, coal: 0, stone: 999, oil: 0 });
    const noOil = owned.find((h) => !h.resources.includes('oil'))!;
    expect(() => sim.build(country.id, 'well', noOil)).toThrowError(/petróleo/);
  });

  it('un fundador no puede ser ciudadano de otra nación', () => {
    const sim = newSim(generateWorld());
    const a = foundA(sim, 'Alfa').country;
    const b = foundA(sim, 'Beta').country;
    expect(() => sim.joinCountry('u-Alfa', 'x', b.id)).toThrowError(/fundador/);
    expect(() => sim.joinCountry('u-Alfa', 'x', a.id)).toThrowError(/fundador/);
  });
});

describe('mercado global y mercado negro', () => {
  it('compra y vende con el spread del mercado', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim);
    const before = sim.getInventories(country.id)!.cg!;
    sim.marketBuy(country.id, 'iron', 10);
    const afterBuy = sim.getInventories(country.id)!;
    expect(afterBuy.iron).toBe(10);
    expect(afterBuy.cg).toBeLessThan(before);
    const quote = sim.marketQuotes().quotes.find((q) => q.resource === 'iron')!;
    expect(quote.buy).toBeGreaterThan(quote.sell);
  });

  it('bloquea el mercado a embargados y parias, pero el mercado negro funciona', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim);
    sim.withdrawFromAssembly(country.id);
    expect(sim.marketAccessBlocked(country.id)).toBe(true);
    expect(() => sim.marketBuy(country.id, 'iron', 5)).toThrowError(/mercado global/);
    sim.blackMarketBuy(country.id, 'iron', 5);
    expect(sim.getInventories(country.id)!.iron).toBe(5);
    // Los parias pagan menos contrabando que un miembro sancionado.
    const pariahPrice = sim.blackMarketQuotes(country.id).find((q) => q.resource === 'iron')!.buy;
    const b = foundA(sim, 'Beta').country;
    const memberPrice = sim.blackMarketQuotes(b.id).find((q) => q.resource === 'iron')!.buy;
    expect(pariahPrice).toBeLessThan(memberPrice);
  });
});

/** Mundo artificial con dos países adyacentes (para tests de guerra). */
function makeWarWorld(): { world: WorldMap; a: string; b: string } {
  const defs = [
    { id: 'A', hexes: [[0, 0], [0, 1], [-1, 1]], capital: [0, 0] },
    { id: 'B', hexes: [[1, 0], [1, -1], [2, -1]], capital: [1, 0] },
  ];
  const hexes: WorldHex[] = [];
  for (const d of defs) {
    for (const [q, r] of d.hexes) {
      hexes.push({
        q: q as number, r: r as number, biome: 'plain', elevation: 0, isCoast: true,
        countryId: d.id, resources: ['food'], isCapital: q === d.capital[0] && r === d.capital[1],
      });
    }
  }
  const world: WorldMap = {
    seed: 'war-test', hexCount: hexes.length, hexes,
    countries: [
      { id: 'A', name: 'País A', color: '#ff0000', capital: { q: 0, r: 0 } },
      { id: 'B', name: 'País B', color: '#0000ff', capital: { q: 1, r: 0 } },
    ],
  };
  return { world, a: 'A', b: 'B' };
}

describe('guerra y suministros', () => {
  function setupWar() {
    const { world, a, b } = makeWarWorld();
    const sim = newSim(world);
    sim.setInventories(a, { cg: 50_000, food: 0, iron: 500, coal: 0, stone: 0, oil: 0 });
    const army = sim.recruit(a, 'infantry');
    sim.tick(() => 0.5); // avanzar un Tick para habilitar el movimiento
    return { sim, a, b, army };
  }

  it('recluta con coste de conscripción', () => {
    const { world } = makeWarWorld();
    const sim = newSim(world);
    sim.getCountry('A')!.constitution = { ...DEFAULT_CONSTITUTION, militaryDoctrine: 'conscription' };
    sim.setInventories('A', { cg: 50_000, food: 0, iron: 500, coal: 0, stone: 0, oil: 0 });
    const army = sim.recruit('A', 'infantry');
    expect(army.soldiers).toBe(50);
    expect(sim.getInventories('A')!.cg).toBe(50_000 - 150); // mitad de 300
  });

  it('exige declarar la guerra antes de atacar', () => {
    const { sim, a, b, army } = setupWar();
    expect(() => sim.attackHex(army.id, { q: 1, r: 0 })).toThrowError(/guerra/);
    sim.declareWar(a, b);
    expect(sim.allWars().length).toBe(1);
  });

  it('declara guerra, ataca y captura territorio con infantería', () => {
    const { sim, a, b, army } = setupWar();
    sim.declareWar(a, b);
    const result = sim.attackHex(army.id, { q: 1, r: 0 });
    expect(result.result).toBe('captured');
    expect(sim.getHex(1, 0)!.countryId).toBe(a);
    expect(sim.allWars()[0]!.capturedHexes.length).toBe(1);
  });

  it('asienta la paz con indemnización y convierte en títere', () => {
    const { sim, a, b, army } = setupWar();
    sim.declareWar(a, b);
    sim.attackHex(army.id, { q: 1, r: 0 });
    const war = sim.allWars()[0]!;
    const defCg = sim.getInventories(b)!.cg!;
    sim.settleWar(war.id, a, 'indemnity');
    expect(sim.allWars()[0]!.status).toBe('ended');
    expect(sim.getInventories(b)!.cg).toBeLessThan(defCg);
  });

  it('las tropas sin línea de suministro se desgastan', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim);
    sim.setInventories(country.id, { cg: 50_000, food: 0, iron: 500, coal: 0, stone: 0, oil: 0 });
    const army = sim.recruit(country.id, 'infantry');
    // Desconectar el hex del ejército y la capital de su país.
    const enemy = foundA(sim, 'Enemigo').country;
    sim.getHex(army.hex.q, army.hex.r)!.countryId = enemy.id;
    sim.getHex(country.capital.q, country.capital.r)!.countryId = enemy.id;
    sim.tick(() => 0.5);
    const after = sim.allArmies().find((x) => x.id === army.id);
    expect(after?.supply).toBe(false);
    expect(after!.soldiers).toBeLessThan(50);
  });
});

describe('Asamblea Global, espionaje y revoluciones', () => {
  it('aprueba un embargo con voto ponderado al resolver el Tick', () => {
    const sim = newSim(generateWorld());
    const a = foundA(sim, 'Alfa').country;
    const b = foundA(sim, 'Beta').country;
    const p = sim.propose(a.id, 'embargo', b.id, 0);
    p.closesAt = Date.now() - 1; // forzar cierre
    sim.tick(() => 0.5);
    expect(sim.isEmbargoed(b.id)).toBe(true);
    expect(() => sim.marketBuy(b.id, 'iron', 5)).toThrowError(/mercado global/);
  });

  it('los parias no votan ni proponen, y pueden reincorporarse', () => {
    const sim = newSim(generateWorld());
    const a = foundA(sim, 'Alfa').country;
    const b = foundA(sim, 'Beta').country;
    sim.withdrawFromAssembly(a.id);
    expect(sim.getCountry(a.id)!.isPariah).toBe(true);
    const p = sim.propose(b.id, 'tax', null, 5);
    expect(() => sim.vote(a.id, p.id, 'yes')).toThrowError(/paria/);
    sim.setInventories(a.id, { cg: 50_000, food: 0, iron: 0, coal: 0, stone: 0, oil: 0 });
    sim.rejoinAssembly(a.id);
    expect(sim.getCountry(a.id)!.isPariah).toBe(false);
  });

  it('el espionaje roba CG con éxito y financia guerras proxy', () => {
    const sim = newSim(generateWorld());
    const a = foundA(sim, 'Alfa').country;
    const b = foundA(sim, 'Beta').country;
    sim.setInventories(a.id, { cg: 50_000, food: 0, iron: 0, coal: 0, stone: 0, oil: 0 });
    const m = sim.launchMission(a.id, b.id, 'heist', () => 0.1); // rng bajo → éxito
    expect(m.status).toBe('success');
    expect(m.result).toMatch(/CG/);
    const proxy = sim.launchMission(a.id, b.id, 'proxy', () => 0.1);
    expect(sim.getCountry(b.id)!.rebellionStrength).toBeGreaterThan(0);
    expect(proxy.result).toMatch(/proxy/i);
  });

  it('un golpe de estado cambia al fundador', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim, 'Dictadura', { ...DEFAULT_CONSTITUTION, government: 'autocracy' });
    sim.joinCountry('rebel-1', 'rebelde', country.id);
    sim.joinRebellion('rebel-1', country.id);
    sim.getCountry(country.id)!.rebellionStrength = 20; // rebelión fuerte
    const r = sim.coupAttempt('rebel-1', country.id, () => 0.01);
    expect(r.success).toBe(true);
    expect(sim.getCountry(country.id)!.foundedBy).toBe('rebel-1');
  });
});

describe('Tick completo', () => {
  it('produce según constitución y paga salarios', () => {
    const sim = newSim(generateWorld());
    const planned: Constitution = { ...DEFAULT_CONSTITUTION, economy: 'planned', militaryDoctrine: 'conscription' };
    const freeMarket: Constitution = { ...DEFAULT_CONSTITUTION, economy: 'free_market' };
    const a = foundA(sim, 'Planificada', planned).country;
    const b = foundA(sim, 'Mercado', freeMarket).country;
    const r = sim.tick(() => 0.5);
    const cgA = r.inventories.get(a.id)!.cg!;
    const cgB = r.inventories.get(b.id)!.cg!;
    expect(cgB).toBeGreaterThan(cgA);
    expect(sim.getCountry(a.id)!.gdp).toBeGreaterThan(0);
  });

  it('emite hambruna y dispara infelicidad', () => {
    const sim = newSim(generateWorld());
    const { country } = foundA(sim, 'SinComida');
    for (const h of sim.ownedHexes(country.id)) h.resources = [];
    sim.setInventories(country.id, { cg: 0, food: 0, iron: 0, coal: 0, stone: 0, oil: 0 });
    let famine = false;
    for (let i = 0; i < 3; i++) {
      const r = sim.tick(() => 0.5);
      if (r.events.some((e) => e.type === 'famine')) famine = true;
    }
    expect(famine).toBe(true);
    expect(sim.getCountry(country.id)!.happiness).toBeLessThan(50);
  });
});
