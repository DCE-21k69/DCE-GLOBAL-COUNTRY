import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, hexKey, hexNeighbors, type WorldMap } from '@dce/shared';
import { buildApp, type AppContext } from '../src/index';

let ctx: AppContext;

beforeEach(async () => {
  ctx = await buildApp({ tick: false });
});

afterEach(async () => {
  await ctx.app.close();
});

async function register(app: AppContext['app'], username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username, email: `${username}@dce.test`, password: 'password123' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function freeFrontierHex(world: WorldMap) {
  const free = world.hexes.filter((h) => h.countryId === null);
  const freeSet = new Set(free.map((h) => hexKey(h)));
  const visited = new Set<string>();
  for (const start of free) {
    const k = hexKey(start);
    if (visited.has(k)) continue;
    const component: typeof free = [];
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
    if (component.length >= 10) return component.find((h) => h.isCoast) ?? component[0]!;
  }
  throw new Error('sin tierra colonizable');
}

async function found(app: AppContext['app'], token: string, name: string, color = '#2233aa') {
  const world: WorldMap = (await app.inject({ method: 'GET', url: '/api/world' })).json();
  const hex = freeFrontierHex(world);
  const res = await app.inject({
    method: 'POST', url: '/api/countries', headers: auth(token),
    payload: { name, color, constitution: DEFAULT_CONSTITUTION, hex: { q: hex.q, r: hex.r } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().country as { id: string };
}

describe('v1.0 — ciudadanía, economía y mercado', () => {
  it('un ciudadano se une, trabaja en un edificio y emigra', async () => {
    const founder = await register(ctx.app, 'jefe');
    const worker = await register(ctx.app, 'obrero');
    const country = await found(ctx.app, founder, 'Fábrica Land');

    // Fundador construye una granja.
    const buildings = await ctx.app.inject({ method: 'GET', url: '/api/buildings', headers: auth(founder) });
    const owned = ctx.sim.ownedHexes(country.id);
    const farmRes = await ctx.app.inject({
      method: 'POST', url: '/api/buildings', headers: auth(founder),
      payload: { type: 'farm', hex: { q: owned[0]!.q, r: owned[0]!.r } },
    });
    expect(farmRes.statusCode).toBe(201);
    const farmId = farmRes.json().building.id as string;

    // Obrero se une y se asigna al edificio.
    const join = await ctx.app.inject({
      method: 'POST', url: '/api/citizenship', headers: auth(worker),
      payload: { countryId: country.id },
    });
    expect(join.statusCode).toBe(200);
    const work = await ctx.app.inject({
      method: 'POST', url: '/api/work', headers: auth(worker),
      payload: { buildingId: farmId },
    });
    expect(work.statusCode).toBe(200);
    expect(ctx.sim.buildingsOf(country.id)[0]!.workers).toBe(1);

    // Emigra.
    const leave = await ctx.app.inject({ method: 'DELETE', url: '/api/citizenship', headers: auth(worker) });
    expect(leave.statusCode).toBe(200);
    expect(ctx.sim.myCitizenship('obrero')).toBeNull();
  });

  it('compra y vende en el mercado global con precios reales', async () => {
    const founder = await register(ctx.app, 'trader');
    const country = await found(ctx.app, founder, 'Trading Co');
    const sell = await ctx.app.inject({
      method: 'POST', url: '/api/market/sell', headers: auth(founder),
      payload: { resource: 'food', qty: 100 },
    });
    expect(sell.statusCode).toBe(200);
    const before = ctx.sim.getInventories(country.id)!.cg!;
    const buy = await ctx.app.inject({
      method: 'POST', url: '/api/market/buy', headers: auth(founder),
      payload: { resource: 'iron', qty: 20 },
    });
    expect(buy.statusCode).toBe(200);
    expect(ctx.sim.getInventories(country.id)!.iron).toBe(20);
    expect(ctx.sim.getInventories(country.id)!.cg).toBeLessThan(before);
  });
});

describe('v1.0 — guerra vía API', () => {
  it('recluta, se mueve en territorio propio y exige guerra para atacar', async () => {
    const founder = await register(ctx.app, 'warlord');
    const country = await found(ctx.app, founder, 'Militaria');

    // Comprar hierro para reclutar infantería.
    await ctx.app.inject({
      method: 'POST', url: '/api/market/buy', headers: auth(founder),
      payload: { resource: 'iron', qty: 40 },
    });
    const recruit = await ctx.app.inject({
      method: 'POST', url: '/api/armies', headers: auth(founder),
      payload: { unitType: 'infantry' },
    });
    expect(recruit.statusCode).toBe(201);
    const army = recruit.json().army as { id: string };

    ctx.sim.tick(() => 0.5); // avanzar Tick para habilitar movimiento

    // Moverse a un hex propio adyacente.
    const pos = ctx.sim.allArmies().find((a) => a.id === army.id)!.hex;
    const neighbor = hexNeighbors(pos)
      .map((n) => ctx.sim.getHex(n.q, n.r))
      .find((h) => h && h.countryId === country.id)!;
    const move = await ctx.app.inject({
      method: 'POST', url: `/api/armies/${army.id}/move`, headers: auth(founder),
      payload: { hex: { q: neighbor.q, r: neighbor.r } },
    });
    expect(move.statusCode).toBe(200);

    // Declarar la guerra a un NPC y atacar (puede fallar por no adyacencia → 400 de regla).
    const declare = await ctx.app.inject({
      method: 'POST', url: '/api/wars', headers: auth(founder),
      payload: { targetCountryId: ctx.sim.getWorld().countries[0]!.id },
    });
    expect(declare.statusCode).toBe(201);
    const wars = await ctx.app.inject({ method: 'GET', url: '/api/wars' });
    expect(wars.json().wars.length).toBeGreaterThan(0);

    // Paz blanca siempre disponible para el agresor.
    const warId = declare.json().wars[0].id as string;
    const settle = await ctx.app.inject({
      method: 'POST', url: `/api/wars/${warId}/settle`, headers: auth(founder),
      payload: { terms: 'white_peace' },
    });
    expect(settle.statusCode).toBe(200);
  });
});

describe('v1.0 — asamblea, espionaje y rebelión', () => {
  it('aprueba un embargo con voto ponderado y bloquea el mercado del objetivo', async () => {
    const t1 = await register(ctx.app, 'potencia');
    const t2 = await register(ctx.app, 'victima');
    const a = await found(ctx.app, t1, 'Potencias Unidas');
    const b = await found(ctx.app, t2, 'Víctimas Reunidas');

    const prop = await ctx.app.inject({
      method: 'POST', url: '/api/assembly/proposals', headers: auth(t1),
      payload: { kind: 'embargo', targetCountryId: b.id },
    });
    expect(prop.statusCode).toBe(201);
    const proposalId = prop.json().proposal.id as string;

    const vote = await ctx.app.inject({
      method: 'POST', url: `/api/assembly/proposals/${proposalId}/vote`, headers: auth(t1),
      payload: { vote: 'yes' },
    });
    expect(vote.statusCode).toBe(200);

    // Forzar cierre y resolver en el Tick.
    const p = ctx.sim.listProposals().find((x) => x.id === proposalId)!;
    p.closesAt = Date.now() - 1;
    ctx.sim.tick(() => 0.5);
    expect(ctx.sim.isEmbargoed(b.id)).toBe(true);

    // El mercado del objetivo queda bloqueado.
    const blocked = await ctx.app.inject({
      method: 'POST', url: '/api/market/buy', headers: auth(t2),
      payload: { resource: 'iron', qty: 5 },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe('market_blocked');

    // Pero el mercado negro sigue funcionando.
    const black = await ctx.app.inject({
      method: 'POST', url: '/api/black-market/buy', headers: auth(t2),
      payload: { resource: 'iron', qty: 5 },
    });
    expect(black.statusCode).toBe(200);
  });

  it('espía y financia rebeliones con resultados registrados', async () => {
    const t1 = await register(ctx.app, 'agente');
    const t2 = await register(ctx.app, 'objetivo');
    const a = await found(ctx.app, t1, 'Agencia');
    const b = await found(ctx.app, t2, 'Objetivo');
    const mission = await ctx.app.inject({
      method: 'POST', url: '/api/espionage', headers: auth(t1),
      payload: { targetCountryId: b.id, kind: 'proxy' },
    });
    expect(mission.statusCode).toBe(201);
    const list = await ctx.app.inject({ method: 'GET', url: '/api/espionage', headers: auth(t1) });
    expect(list.json().missions.length).toBe(1);
  });

  it('un ciudadano se une a la rebelión y un golpe débil fracasa', async () => {
    const t1 = await register(ctx.app, 'dictador');
    const t2 = await register(ctx.app, 'revolucionario');
    const country = await found(ctx.app, t1, 'Régimen');
    await ctx.app.inject({
      method: 'POST', url: '/api/citizenship', headers: auth(t2),
      payload: { countryId: country.id },
    });
    const join = await ctx.app.inject({
      method: 'POST', url: '/api/rebellion/join', headers: auth(t2),
      payload: { countryId: country.id },
    });
    expect(join.statusCode).toBe(200);
    expect(ctx.sim.getCountry(country.id)!.rebellionStrength).toBe(2);
    const coup = await ctx.app.inject({
      method: 'POST', url: '/api/rebellion/coup', headers: auth(t2),
      payload: { countryId: country.id },
    });
    expect(coup.statusCode).toBe(400);
    expect(coup.json().error).toBe('weak_rebellion');
  });
});

describe('v1.0 — estado y noticias', () => {
  it('expone noticias, estado del CG y países públicos con wiki', async () => {
    const t = await register(ctx.app, 'narrador');
    await found(ctx.app, t, 'Narrativa');
    const news = await ctx.app.inject({ method: 'GET', url: '/api/news' });
    expect(news.statusCode).toBe(200);
    expect(news.json().length).toBeGreaterThan(0);

    const status = await ctx.app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json().cgState).toBeTruthy();

    const countries = await ctx.app.inject({ method: 'GET', url: '/api/countries' });
    expect(countries.json().countries.length).toBe(5);

    // Wiki editable por el fundador.
    const id = countries.json().countries.find((c: { name: string }) => c.name === 'Narrativa').id;
    const wiki = await ctx.app.inject({
      method: 'PATCH', url: `/api/countries/${id}/wiki`, headers: auth(t),
      payload: { history: 'Nuestra historia épica.', motto: 'Adelante' },
    });
    expect(wiki.statusCode).toBe(200);
    const profile = await ctx.app.inject({ method: 'GET', url: `/api/countries/${id}` });
    expect(profile.json().country.wiki.history).toBe('Nuestra historia épica.');
  });
});
