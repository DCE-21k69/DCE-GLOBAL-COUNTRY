// ============================================================================
// @dce/api — Servidor Fastify del Alpha.
// Endpoints v0: /health, /api/world
// Los endpoints de países, economía y combate llegarán en Sprints posteriores
// (ver docs/02-roadmap-sprints.md).
// ============================================================================

import Fastify from 'fastify';

export const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

// ── Healthcheck (para el Live Preview y los checks de CI) ──────────────────
app.get('/health', async () => ({
  status: 'ok',
  service: '@dce/api',
  version: '0.1.0-alpha',
  uptimeSeconds: Math.round(process.uptime()),
}));

// ── Mundo: el estado completo del mapa procedimental (GDD §2) ──────────────
// Determinista por seed: el cliente puede renderizar el mismo mapa offline.
// El cache evita regenerar el mundo en cada request (miles de hexágonos).
app.get('/api/world', async (request, reply) => {
  const seed = (request.query as { seed?: string }).seed ?? DEFAULT_SEED;
  const world = getWorld(seed);
  reply.header('Cache-Control', 'public, max-age=300');
  return world;
});

import { DEFAULT_SEED, generateWorld, type WorldMap } from '@dce/shared';

const worldCache = new Map<string, WorldMap>();
const MAX_CACHE_ENTRIES = 16;

function getWorld(seed: string): WorldMap {
  let world = worldCache.get(seed);
  if (!world) {
    world = generateWorld(seed);
    if (worldCache.size >= MAX_CACHE_ENTRIES) {
      // Desalojo simple: borrar la entrada más antigua (Map preserva orden).
      const firstKey = worldCache.keys().next().value;
      if (firstKey !== undefined) worldCache.delete(firstKey);
    }
    worldCache.set(seed, world);
  }
  return world;
}

// ── Arranque ───────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8080);

if (process.env.NODE_ENV !== 'test') {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`@dce/api escuchando en http://0.0.0.0:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
