// ============================================================================
// @dce/api — Servidor Fastify (Alpha v0.2).
//
// Endpoints:
//   GET  /health            → estado del servicio
//   GET  /api/status        → temporizador de Tick y contadores del mundo
//   GET  /api/world         → estado completo del mapa (generador + jugadores)
//   POST /api/auth/register → crear cuenta (JWT)
//   POST /api/auth/login    → iniciar sesión (JWT)
//   GET  /api/auth/me       → usuario actual (+ país si existe)
//   GET  /api/me            → detalle de MI país (inventarios, hexágonos)
//   POST /api/countries     → fundar una nación (GDD §2/§3)
//   WS   /ws                → eventos en vivo (country_created, tick)
//
// Persistencia: Store (MemoryStore por defecto; PostgresStore con DATABASE_URL).
// Motor: Simulation (@dce/simulation) — estado en RAM, autoridad del mundo.
// ============================================================================

import 'dotenv/config';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SEED,
  generateWorld,
  isValidConstitution,
  type CountryMeta,
  type Hex,
  type WorldMap,
} from '@dce/shared';
import { SimError, Simulation } from '@dce/simulation';
import { hashPassword, verifyPassword } from './auth';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/types';
import { WsHub } from './wsHub';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dce-dev-secret';
const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 8080);
/** 10 min por Tick (GDD §5); en desarrollo, 45 s para que sea visible. */
const TICK_SECONDS = Number(process.env.TICK_SECONDS ?? (IS_PROD ? 600 : 45));

export interface BuildOptions {
  store?: Store;
  /** Arranca el bucle de Ticks (false en tests). */
  tick?: boolean;
  seed?: string;
}

export interface AppContext {
  app: FastifyInstance;
  sim: Simulation;
  store: Store;
  hub: WsHub;
  state: { nextTickAt: number; tickSeconds: number };
}

async function createStore(logger: { warn: (msg: string) => void }): Promise<Store> {
  if (process.env.DATABASE_URL) {
    const store = new PostgresStore(process.env.DATABASE_URL);
    await store.init();
    return store;
  }
  logger.warn(
    '[store] DATABASE_URL no definido → MemoryStore (estado en memoria, se pierde al reiniciar). ' +
      'Define DATABASE_URL para persistir en PostgreSQL.',
  );
  return new MemoryStore();
}

export async function buildApp(opts: BuildOptions = {}): Promise<AppContext> {
  const app: FastifyInstance = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const store = opts.store ?? (await createStore(app.log));
  const hub = new WsHub();
  const state = { nextTickAt: 0, tickSeconds: TICK_SECONDS };

  // ── Boot del mundo: generador determinista + estado persistido ──────────
  const seed = opts.seed ?? DEFAULT_SEED;
  const baseWorld = generateWorld(seed);
  const storedCountries = await store.listCountries();
  const ownership = await store.getOwnership();
  const sim = new Simulation(baseWorld, storedCountries, ownership);
  for (const country of sim.listCountries()) {
    const inv = await store.getInventories(country.id);
    if (inv) sim.setInventories(country.id, inv);
  }

  // ── Plugins ──────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(fastifyWebsocket);
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'unauthorized', message: 'Necesitas iniciar sesión.' });
    }
  });

  // ── Tick loop (motor económico, GDD §4) ─────────────────────────────────
  let tickStarted = false;
  const runTick = async () => {
    try {
      const result = sim.tick();
      state.nextTickAt = Date.now() + TICK_SECONDS * 1000;
      for (const [countryId, inv] of result.inventories) {
        await store.saveInventories(countryId, inv);
      }
      hub.broadcast('tick', { nextTickAt: state.nextTickAt, tickSeconds: TICK_SECONDS });
      for (const ev of result.events) {
        if (ev.type === 'famine') {
          hub.broadcast('famine', { countryId: ev.countryId });
        }
      }
    } catch (err) {
      app.log.error(err, 'tick failed');
    }
  };
  const startTickLoop = () => {
    if (tickStarted || opts.tick === false) return;
    tickStarted = true;
    state.nextTickAt = Date.now() + TICK_SECONDS * 1000;
    setInterval(runTick, TICK_SECONDS * 1000);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────
  const publicUser = (u: { id: string; username: string; email: string; createdAt: string }) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    createdAt: u.createdAt,
  });

  const countryDetail = (c: CountryMeta) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    capital: c.capital,
    constitution: c.constitution,
    population: c.population,
    foundedAt: c.createdAt,
    hexCount: sim.ownedHexes(c.id).length,
    inventories: sim.getInventories(c.id) ?? {},
  });

  // ── Rutas ───────────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    service: '@dce/api',
    version: '0.2.0-alpha',
    store: store.constructor.name,
    wsClients: hub.clientCount,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/api/status', async () => ({
    tickSeconds: TICK_SECONDS,
    nextTickAt: state.nextTickAt,
    countries: sim.listCountries().length,
    hexCount: sim.getWorld().hexCount,
    wsClients: hub.clientCount,
  }));

  app.get('/api/world', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return sim.getWorld();
  });

  // ── Autenticación ───────────────────────────────────────────────────────
  app.post('/api/auth/register', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: string; email?: string; password?: string };
    const username = (body.username ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return reply.code(400).send({ error: 'invalid_username', message: 'Usuario: 3-20 caracteres (letras, números, _).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'invalid_email', message: 'Correo electrónico inválido.' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'weak_password', message: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    if (await store.findUserByUsername(username)) {
      return reply.code(409).send({ error: 'username_taken', message: 'Ese nombre de usuario ya existe.' });
    }

    const user = {
      id: randomUUID(),
      username,
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await store.createUser(user);
    const token = app.jwt.sign({ sub: user.id });
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: string; password?: string };
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';

    const user = await store.findUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
    }
    const token = app.jwt.sign({ sub: user.id });
    return { token, user: publicUser(user) };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const user = await store.findUserById(userId);
    if (!user) return { user: null, country: null };
    const country = sim.listCountries().find((c) => c.foundedBy === userId) ?? null;
    return { user: publicUser(user), country: country ? countryDetail(country) : null };
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const country = sim.listCountries().find((c) => c.foundedBy === userId);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'Aún no has fundado una nación.' });
    return { country: countryDetail(country) };
  });

  // ── Fundación de naciones ───────────────────────────────────────────────
  app.post('/api/countries', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    if (sim.listCountries().some((c) => c.foundedBy === userId)) {
      return reply.code(400).send({ error: 'already_founded', message: 'Ya has fundado una nación.' });
    }

    const body = (request.body ?? {}) as {
      name?: string;
      color?: string;
      constitution?: unknown;
      hex?: { q?: number; r?: number };
    };
    if (!body.hex || typeof body.hex.q !== 'number' || typeof body.hex.r !== 'number') {
      return reply.code(400).send({ error: 'invalid_hex', message: 'Falta el hexágono de fundación.' });
    }
    if (!isValidConstitution(body.constitution)) {
      return reply.code(400).send({ error: 'invalid_constitution', message: 'Constitución inválida.' });
    }

    try {
      const { country, claimed } = sim.foundCountry({
        name: body.name ?? '',
        color: body.color ?? '',
        constitution: body.constitution,
        foundedBy: userId,
        hex: { q: body.hex.q, r: body.hex.r } as Hex,
      });
      await store.createCountry(country, claimed);
      await store.saveInventories(country.id, sim.getInventories(country.id)!);
      hub.broadcast('country_created', { country: countryDetail(country) });
      return reply.code(201).send({ country: countryDetail(country), claimedHexCount: claimed.length });
    } catch (err) {
      if (err instanceof SimError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // ── WebSocket ───────────────────────────────────────────────────────────
  app.get('/ws', { websocket: true }, (socket) => {
    hub.connect(socket);
    socket.on('close', () => hub.disconnect(socket));
    socket.on('error', () => hub.disconnect(socket));
  });

  startTickLoop();

  return { app, sim, store, hub, state };
}

// ── Arranque ───────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const { app } = await buildApp({ tick: true });
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`@dce/api escuchando en http://0.0.0.0:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
