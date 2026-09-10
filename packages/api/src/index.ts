// ============================================================================
// @dce/api — Servidor Fastify (v1.0-alpha): TODOS los sistemas del GDD.
//
// Autenticación (JWT), fundación, ciudadanía, economía (edificios, mercado,
// CG), diplomacia (tratados, guerra, paz, títeres), Asamblea Global, espionaje,
// mercado negro, revoluciones y noticias. El motor (@dce/simulation) es la
// autoridad; la persistencia es por snapshot (Store: memoria o PostgreSQL).
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
  type AnyResource,
  type CountryMeta,
  type FlagLayers,
  type Hex,
  type MissionKind,
  type ProposalKind,
  type TreatyKind,
  type UnitType,
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
const TICK_SECONDS = Number(process.env.TICK_SECONDS ?? (IS_PROD ? 600 : 45));

export interface BuildOptions {
  store?: Store;
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

  // ── Boot: generador determinista + snapshot persistido ───────────────────
  const seed = opts.seed ?? DEFAULT_SEED;
  const sim = new Simulation(seed, generateWorld(seed), await store.loadState());

  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(fastifyWebsocket);
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'unauthorized', message: 'Necesitas iniciar sesión.' });
    }
  });

  // ── Tick loop ────────────────────────────────────────────────────────────
  let tickStarted = false;
  const runTick = async () => {
    try {
      const result = sim.tick();
      state.nextTickAt = Date.now() + TICK_SECONDS * 1000;
      await store.saveState(sim.serialize());
      hub.broadcast('tick', { nextTickAt: state.nextTickAt, tickSeconds: TICK_SECONDS });
      for (const ev of result.events) {
        if (ev.type === 'famine') hub.broadcast('famine', { countryId: ev.countryId });
      }
      const latest = sim.getNews()[0];
      if (latest) hub.broadcast('news', { event: latest });
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

  // ── Helpers ──────────────────────────────────────────────────────────────
  const persist = () => store.saveState(sim.serialize());
  const broadcastNews = () => {
    const latest = sim.getNews()[0];
    if (latest) hub.broadcast('news', { event: latest });
  };

  const userIdOf = (request: FastifyRequest): string => (request.user as { sub: string }).sub;
  const myCountryOf = (request: FastifyRequest): CountryMeta | undefined => {
    const userId = userIdOf(request);
    return sim.listCountries().find((c) => c.foundedBy === userId);
  };
  /** País donde el usuario es fundador o ministro (permisos de gestión). */
  const actingCountryOf = (request: FastifyRequest): CountryMeta | undefined => {
    const userId = userIdOf(request);
    const founded = sim.listCountries().find((c) => c.foundedBy === userId);
    if (founded) return founded;
    const citizenship = sim.myCitizenship(userId);
    if (citizenship?.role === 'minister') return sim.getCountry(citizenship.countryId);
    return undefined;
  };
  const isFounder = (request: FastifyRequest, countryId: string): boolean => {
    return sim.getCountry(countryId)?.foundedBy === userIdOf(request);
  };

  const countryDetail = (c: CountryMeta) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    flagSvg: c.flagSvg,
    capital: c.capital,
    constitution: c.constitution,
    population: c.population,
    happiness: c.happiness,
    salary: c.salary,
    currencyCode: c.currencyCode,
    gdp: c.gdp,
    rebellionStrength: c.rebellionStrength,
    isPariah: c.isPariah,
    isPuppetOf: c.isPuppetOf,
    foundedAt: c.createdAt,
    foundedBy: c.foundedBy,
    npc: c.npc,
    hexCount: sim.ownedHexes(c.id).length,
    inventories: sim.getInventories(c.id) ?? {},
    buildings: sim.buildingsOf(c.id).length,
    citizens: sim.citizensOf(c.id).length,
  });

  const publicCountry = (c: CountryMeta) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    flagSvg: c.flagSvg,
    npc: c.npc,
    isPariah: c.isPariah,
    isPuppetOf: c.isPuppetOf,
    population: c.population,
    gdp: c.gdp,
    happiness: c.happiness,
    currencyCode: c.currencyCode,
    hexCount: sim.ownedHexes(c.id).length,
    wiki: { history: c.wikiHistory, motto: c.wikiMotto },
    treaties: sim.treatiesOf(c.id).map((t) => ({
      kind: t.kind,
      with: t.a === c.id ? t.b : t.a,
    })),
    wars: sim.warsOf(c.id).map((w) => ({ id: w.id, against: w.aggressorId === c.id ? w.defenderId : w.aggressorId })),
  });

  const sendSimError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof SimError) return reply.code(400).send({ error: err.code, message: err.message });
    throw err;
  };

  // ── Rutas base ───────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok', service: '@dce/api', version: '1.0.0-alpha',
    store: store.constructor.name, wsClients: hub.clientCount,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/api/status', async () => ({
    tickSeconds: TICK_SECONDS,
    nextTickAt: state.nextTickAt,
    countries: sim.listCountries().length,
    hexCount: sim.getWorld().hexCount,
    wsClients: hub.clientCount,
    cgState: sim.getCgState(),
    globalTax: sim.getGlobalTaxPercent(),
  }));

  app.get('/api/news', async () => sim.getNews());

  app.get('/api/world', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return sim.getWorld();
  });

  // ── Autenticación ────────────────────────────────────────────────────────

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
      id: randomUUID(), username, email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await store.createUser(user);
    return reply.code(201).send({ token: app.jwt.sign({ sub: user.id }), user: { id: user.id, username, email, createdAt: user.createdAt } });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: string; password?: string };
    const user = await store.findUserByUsername((body.username ?? '').trim());
    if (!user || !(await verifyPassword(body.password ?? '', user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' });
    }
    return { token: app.jwt.sign({ sub: user.id }), user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt } };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
    const userId = userIdOf(request);
    const user = await store.findUserById(userId);
    if (!user) return { user: null, country: null, citizenship: null };
    const country = sim.listCountries().find((c) => c.foundedBy === userId) ?? null;
    const citizenship = sim.myCitizenship(userId);
    return {
      user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt },
      country: country ? countryDetail(country) : null,
      citizenship: citizenship
        ? { countryId: citizenship.countryId, countryName: sim.getCountry(citizenship.countryId)?.name, role: citizenship.role, assignedBuildingId: citizenship.assignedBuildingId }
        : null,
    };
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const country = myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'Aún no has fundado una nación.' });
    return { country: countryDetail(country) };
  });

  // ── Países públicos y Wiki Nacional ──────────────────────────────────────

  app.get('/api/countries', async () => ({ countries: sim.listCountries().map(publicCountry) }));

  app.get('/api/countries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const country = sim.getCountry(id);
    if (!country) return reply.code(404).send({ error: 'not_found', message: 'País inexistente.' });
    return { country: publicCountry(country) };
  });

  app.patch('/api/countries/:id/wiki', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isFounder(request, id)) return reply.code(403).send({ error: 'forbidden', message: 'Solo el fundador edita la Wiki Nacional.' });
    const body = (request.body ?? {}) as { history?: string; motto?: string };
    try {
      sim.updateWiki(id, body.history ?? '', body.motto ?? '');
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.patch('/api/countries/:id/flag', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isFounder(request, id)) return reply.code(403).send({ error: 'forbidden', message: 'Solo el fundador cambia la bandera.' });
    const layers = (request.body ?? {}) as FlagLayers;
    try {
      sim.updateFlag(id, layers);
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/countries', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = userIdOf(request);
    if (sim.listCountries().some((c) => c.foundedBy === userId)) {
      return reply.code(400).send({ error: 'already_founded', message: 'Ya has fundado una nación.' });
    }
    const body = (request.body ?? {}) as { name?: string; color?: string; constitution?: unknown; hex?: { q?: number; r?: number } };
    if (!body.hex || typeof body.hex.q !== 'number' || typeof body.hex.r !== 'number') {
      return reply.code(400).send({ error: 'invalid_hex', message: 'Falta el hexágono de fundación.' });
    }
    if (!isValidConstitution(body.constitution)) {
      return reply.code(400).send({ error: 'invalid_constitution', message: 'Constitución inválida.' });
    }
    try {
      const { country, claimed } = sim.foundCountry({
        name: body.name ?? '', color: body.color ?? '', constitution: body.constitution,
        foundedBy: userId, hex: { q: body.hex.q, r: body.hex.r } as Hex,
      });
      await persist();
      hub.broadcast('country_created', { country: countryDetail(country) });
      broadcastNews();
      return reply.code(201).send({ country: countryDetail(country), claimedHexCount: claimed.length });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Ciudadanía, trabajo y ministros (GDD §5) ─────────────────────────────

  app.post('/api/citizenship', { preHandler: app.authenticate }, async (request, reply) => {
    const body = (request.body ?? {}) as { countryId?: string };
    const user = await store.findUserById(userIdOf(request));
    try {
      sim.joinCountry(userIdOf(request), user?.username ?? 'ciudadano', body.countryId ?? '');
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.delete('/api/citizenship', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      sim.leaveCountry(userIdOf(request));
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/work', { preHandler: app.authenticate }, async (request, reply) => {
    const body = (request.body ?? {}) as { buildingId?: string };
    try {
      sim.assignWork(userIdOf(request), body.buildingId ?? '');
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.delete('/api/work', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const citizen = sim.myCitizenship(userIdOf(request));
      if (citizen?.assignedBuildingId) {
        const b = sim.buildingsOf(citizen.countryId).find((x) => x.id === citizen.assignedBuildingId);
        if (b) b.workers = Math.max(0, b.workers - 1);
        citizen.assignedBuildingId = null;
        await persist();
      }
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/salary', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { amount?: number };
    try {
      sim.setSalary(country.id, Number(body.amount));
      await persist();
      return { ok: true, salary: country.salary };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/ministers', { preHandler: app.authenticate }, async (request, reply) => {
    const country = myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No has fundado una nación.' });
    const body = (request.body ?? {}) as { username?: string };
    try {
      sim.appointMinister(country.id, (body.username ?? '').trim());
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.delete('/api/ministers/:userId', { preHandler: app.authenticate }, async (request, reply) => {
    const country = myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No has fundado una nación.' });
    const { userId } = request.params as { userId: string };
    const citizen = sim.myCitizenship(userId);
    if (citizen && citizen.countryId === country.id) {
      citizen.role = 'worker';
      await persist();
    }
    return { ok: true };
  });

  // ── Edificios (GDD §4.2) ────────────────────────────────────────────────

  app.get('/api/buildings', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    return { buildings: sim.buildingsOf(country.id) };
  });

  app.post('/api/buildings', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { type?: string; hex?: { q?: number; r?: number } };
    if (!body.hex || typeof body.hex.q !== 'number' || typeof body.hex.r !== 'number') {
      return reply.code(400).send({ error: 'invalid_hex', message: 'Falta el hexágono.' });
    }
    try {
      const building = sim.build(country.id, body.type as never, { q: body.hex.q, r: body.hex.r });
      await persist();
      return reply.code(201).send({ building });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Mercado y mercado negro (GDD §4.1, §6.2) ────────────────────────────

  app.get('/api/market', async () => {
    const quotes = sim.marketQuotes();
    return { ...quotes, globalTax: sim.getGlobalTaxPercent() };
  });

  app.post('/api/market/buy', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { resource?: string; qty?: number };
    try {
      sim.marketBuy(country.id, body.resource as AnyResource, Number(body.qty));
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/market/sell', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { resource?: string; qty?: number };
    try {
      sim.marketSell(country.id, body.resource as AnyResource, Number(body.qty));
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.get('/api/black-market', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request) ?? myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No tienes nación.' });
    return { quotes: sim.blackMarketQuotes(country.id) };
  });

  app.post('/api/black-market/buy', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request) ?? myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No tienes nación.' });
    const body = (request.body ?? {}) as { resource?: string; qty?: number };
    try {
      sim.blackMarketBuy(country.id, body.resource as AnyResource, Number(body.qty));
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Ejércitos y guerra (GDD §6.1) ───────────────────────────────────────

  app.get('/api/armies', async () => ({ armies: sim.allArmies() }));

  app.post('/api/armies', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { unitType?: string };
    try {
      const army = sim.recruit(country.id, body.unitType as UnitType);
      await persist();
      return reply.code(201).send({ army });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/armies/:id/move', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const { id } = request.params as { id: string };
    const army = sim.allArmies().find((a) => a.id === id);
    if (!army || army.countryId !== country.id) return reply.code(403).send({ error: 'not_yours', message: 'Ese ejército no es tuyo.' });
    const body = (request.body ?? {}) as { hex?: { q?: number; r?: number } };
    try {
      sim.moveArmy(id, { q: body.hex!.q!, r: body.hex!.r! });
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/armies/:id/attack', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const { id } = request.params as { id: string };
    const army = sim.allArmies().find((a) => a.id === id);
    if (!army || army.countryId !== country.id) return reply.code(403).send({ error: 'not_yours', message: 'Ese ejército no es tuyo.' });
    const body = (request.body ?? {}) as { hex?: { q?: number; r?: number } };
    try {
      const result = sim.attackHex(id, { q: body.hex!.q!, r: body.hex!.r! });
      await persist();
      hub.broadcast('battle', { result, hex: body.hex });
      broadcastNews();
      return result;
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.get('/api/wars', async () => ({ wars: sim.allWars() }));

  app.post('/api/wars', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { targetCountryId?: string };
    try {
      const wars = sim.declareWar(country.id, body.targetCountryId ?? '');
      await persist();
      broadcastNews();
      return reply.code(201).send({ wars });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/wars/:id/settle', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { terms?: string };
    try {
      sim.settleWar(id, country.id, body.terms as never);
      await persist();
      broadcastNews();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Tratados (GDD §6.3) ──────────────────────────────────────────────────

  app.post('/api/treaties', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { targetCountryId?: string; kind?: string };
    try {
      const treaty = sim.proposeTreaty(country.id, body.targetCountryId ?? '', body.kind as TreatyKind);
      await persist();
      broadcastNews();
      return reply.code(201).send({ treaty });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Asamblea Global (GDD §6.3) ───────────────────────────────────────────

  app.get('/api/assembly', async () => {
    const proposals = sim.listProposals().map((p) => ({
      ...p,
      proposerName: sim.getCountry(p.proposerId)?.name ?? '?',
      targetName: p.targetCountryId ? sim.getCountry(p.targetCountryId)?.name ?? '?' : null,
    }));
    const members = sim.listCountries().filter((c) => !c.isPariah);
    return { proposals, members: members.map((c) => ({ id: c.id, name: c.name, gdp: c.gdp, population: c.population })), globalTax: sim.getGlobalTaxPercent() };
  });

  app.post('/api/assembly/proposals', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const body = (request.body ?? {}) as { kind?: string; targetCountryId?: string; taxPercent?: number };
    try {
      const p = sim.propose(country.id, body.kind as ProposalKind, body.targetCountryId ?? null, Number(body.taxPercent ?? 0));
      await persist();
      broadcastNews();
      return reply.code(201).send({ proposal: p });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/assembly/proposals/:id/vote', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { vote?: string };
    try {
      sim.vote(country.id, id, body.vote as never);
      await persist();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/assembly/withdraw', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    try {
      sim.withdrawFromAssembly(country.id);
      await persist();
      broadcastNews();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/assembly/join', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No gobiernas ninguna nación.' });
    try {
      sim.rejoinAssembly(country.id);
      await persist();
      broadcastNews();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Espionaje (GDD §6.2) ────────────────────────────────────────────────

  app.get('/api/espionage', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request) ?? myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No tienes nación.' });
    return { missions: sim.missionsOf(country.id) };
  });

  app.post('/api/espionage', { preHandler: app.authenticate }, async (request, reply) => {
    const country = actingCountryOf(request) ?? myCountryOf(request);
    if (!country) return reply.code(404).send({ error: 'no_country', message: 'No tienes nación.' });
    const body = (request.body ?? {}) as { targetCountryId?: string; kind?: string };
    try {
      const mission = sim.launchMission(country.id, body.targetCountryId ?? '', body.kind as MissionKind);
      await persist();
      broadcastNews();
      return reply.code(201).send({ mission });
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── Revolución (GDD §5) ─────────────────────────────────────────────────

  app.post('/api/rebellion/join', { preHandler: app.authenticate }, async (request, reply) => {
    const body = (request.body ?? {}) as { countryId?: string };
    try {
      sim.joinRebellion(userIdOf(request), body.countryId ?? '');
      await persist();
      broadcastNews();
      return { ok: true };
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  app.post('/api/rebellion/coup', { preHandler: app.authenticate }, async (request, reply) => {
    const body = (request.body ?? {}) as { countryId?: string };
    try {
      const result = sim.coupAttempt(userIdOf(request), body.countryId ?? '');
      await persist();
      broadcastNews();
      return result;
    } catch (err) {
      return sendSimError(reply, err);
    }
  });

  // ── WebSocket ────────────────────────────────────────────────────────────

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
    app.log.info(`@dce/api v1.0.0-alpha escuchando en http://0.0.0.0:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
