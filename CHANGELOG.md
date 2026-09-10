# Changelog

Todas las versiones notables del proyecto. El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.0.0/) y el versionado [SemVer](https://semver.org/lang/es/).

## [0.2.0-alpha] — 2026-09-10

### Añadido

- **Cuentas de usuario**: registro, login y sesión con JWT (scrypt para contraseñas). Rutas `/api/auth/register`, `/api/auth/login`, `/api/auth/me`.
- **Fundación de naciones** (`POST /api/countries`): reclama 10-15 hexágonos de tierra libre en la frontera del mundo, con nombre, color y Constitución (GDD §2/§3).
- **Motor de simulación** (`packages/simulation`): estado del mundo en RAM, fundación con reglas validables y Tick económico determinista (producción Tier 1 por biomas, impuestos de CG, consumo de comida, eventos de hambruna).
- **Efectos de la Constitución aplicados por el motor**: economía planificada (+50% producción, −60% CG), libre mercado (×2 CG), servicio obligatorio (−10% producción).
- **Persistencia con doble adaptador**: `MemoryStore` (dev/preview/tests) y `PostgresStore` (producción vía `DATABASE_URL`), ambos tras la interfaz `Store`.
- **Eventos en vivo por WebSocket** (`/ws`): `country_created`, `tick`, `famine` — las fundaciones de otros jugadores aparecen en el mapa en tiempo real.
- **Cliente v0.2**: panel "Mi País" con reservas y constitución, modal de fundación con vista previa de buffs/debuffs, colores reales de país en el mapa, HUD con recursos reales y temporizador del Tick sincronizado con el servidor, toasts.
- **Esquema SQL actualizado**: propiedad del territorio en `country_hexes`, columnas nuevas en `countries` (color, población, capital, bandera).

### Cambiado

- `/api/world` ahora refleja el estado vivo del motor (jugadores + NPC), sin caché estático.
- El API usa `buildApp()` (factory) para tests con aislamiento total.

## [0.1.0-alpha] — 2026-09-10

### Añadido

- Monorepo pnpm: `packages/shared`, `packages/api`, `packages/client`.
- Matemáticas hexagonales (coordenadas axiales) y generador procedural determinista (misma seed → mismo mundo) con biomas, recursos y países NPC.
- API Fastify: `GET /health`, `GET /api/world`.
- Cliente Pixi.js v8: mapa WebGL con filtros Político/Recursos/Militar, zoom/pan, inspector de hexágonos y HUD estratégico.
- Esquema PostgreSQL ejecutable (`sql/schema.sql`) + seed.
- CI de GitHub Actions (tests, typecheck y build).
- Documentación técnica completa en `docs/` (arquitectura, roadmap, base de datos, mapa hexagonal) + GDD canónico.
