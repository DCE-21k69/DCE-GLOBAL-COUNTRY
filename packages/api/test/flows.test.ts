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

async function register(app: AppContext['app'], username: string, password = 'password123'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, email: `${username}@dce.test`, password },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Busca un hexágono libre de una componente con ≥10 hexágonos (colonizable). */
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
  return undefined;
}

describe('flujo completo: cuenta → nación → mundo', () => {
  it('registra, entra y consulta su sesión', async () => {
    const token = await register(ctx.app, 'jefe');
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('jefe');
    expect(me.json().country).toBeNull();
  });

  it('rechaza credenciales incorrectas y duplicados', async () => {
    await register(ctx.app, 'dup');
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'dup', email: 'otro@dce.test', password: 'password123' },
    });
    expect(again.statusCode).toBe(409);

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'dup', password: 'incorrecta' },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'dup', password: 'password123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
  });

  it('protege las rutas privadas con 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    const found = await ctx.app.inject({ method: 'POST', url: '/api/countries', payload: {} });
    expect(found.statusCode).toBe(401);
  });

  it('funda una nación en la frontera y actualiza el mundo visible', async () => {
    const token = await register(ctx.app, 'fundadora');
    const worldRes = await ctx.app.inject({ method: 'GET', url: '/api/world' });
    const world: WorldMap = worldRes.json();
    const hex = freeFrontierHex(world)!;
    expect(hex).toBeTruthy();

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/countries',
      headers: auth(token),
      payload: {
        name: 'Nueva Esperanza',
        color: '#22cc88',
        constitution: DEFAULT_CONSTITUTION,
        hex: { q: hex.q, r: hex.r },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.claimedHexCount).toBeGreaterThanOrEqual(10);
    expect(body.claimedHexCount).toBeLessThanOrEqual(15);
    expect(body.country.inventories.cg).toBe(5000);

    // El mundo ahora incluye la nación y su territorio.
    const world2: WorldMap = (await ctx.app.inject({ method: 'GET', url: '/api/world' })).json();
    expect(world2.countries.length).toBe(5);
    expect(world2.countries.map((c) => c.name)).toContain('Nueva Esperanza');
    const owned = world2.hexes.filter((h) => h.countryId === body.country.id);
    expect(owned.length).toBe(body.claimedHexCount);
    const capital = world2.hexes.find((h) => h.q === hex.q && h.r === hex.r);
    expect(capital?.isCapital).toBe(true);

    // /api/me devuelve el país del usuario autenticado.
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().country.name).toBe('Nueva Esperanza');
  });

  it('aplica reglas de fundación: un país por usuario, nombres únicos, tierra ajena', async () => {
    const t1 = await register(ctx.app, 'primero');
    const t2 = await register(ctx.app, 'segundo');
    const world: WorldMap = (await ctx.app.inject({ method: 'GET', url: '/api/world' })).json();
    const hex = freeFrontierHex(world)!;

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/countries',
      headers: auth(t1),
      payload: { name: 'Única', color: '#123456', constitution: DEFAULT_CONSTITUTION, hex: { q: hex.q, r: hex.r } },
    });
    expect(ok.statusCode).toBe(201);

    // El mismo usuario no puede fundar dos países.
    const world3: WorldMap = (await ctx.app.inject({ method: 'GET', url: '/api/world' })).json();
    const hex2 = freeFrontierHex(world3)!;
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/countries',
      headers: auth(t1),
      payload: { name: 'Otra', color: '#654321', constitution: DEFAULT_CONSTITUTION, hex: { q: hex2.q, r: hex2.r } },
    });
    expect(second.statusCode).toBe(400);

    // Nombre duplicado por otro usuario.
    const dupName = await ctx.app.inject({
      method: 'POST',
      url: '/api/countries',
      headers: auth(t2),
      payload: { name: 'única', color: '#654321', constitution: DEFAULT_CONSTITUTION, hex: { q: hex2.q, r: hex2.r } },
    });
    expect(dupName.statusCode).toBe(400);

    // Fundar sobre territorio ya reclamado.
    const claimedHex = world3.hexes.find((h) => h.countryId !== null)!;
    const claimed = await ctx.app.inject({
      method: 'POST',
      url: '/api/countries',
      headers: auth(t2),
      payload: { name: 'Okupa', color: '#654321', constitution: DEFAULT_CONSTITUTION, hex: { q: claimedHex.q, r: claimedHex.r } },
    });
    expect(claimed.statusCode).toBe(400);
  });
});
