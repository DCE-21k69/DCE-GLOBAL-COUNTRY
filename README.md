# 🌍 DCE Global Country

**Simulador Geopolítico de Naciones** — MMO de navegador donde los jugadores fundan países en un mapa hexagonal procedural, gestionan su economía y constitución, comercian en el mercado global (o en el negro), declaran guerras, firman tratados y viven como ciudadanos de las naciones de otros jugadores.

**Estado actual: Alpha v1.0** — los **Sprints 2–7 están completos**: el MVP del GDD es jugable de punta a punta (fundar → producir → comerciar → aliarse → guerrear). Detalles en [CHANGELOG.md](CHANGELOG.md) y en el [roadmap](docs/02-roadmap-sprints.md).

## 📁 Estructura del monorepo

| Ruta | Qué contiene |
| --- | --- |
| [`docs/`](docs/) | GDD canónico + los 4 entregables técnicos (arquitectura, roadmap, BD, mapa hexagonal) |
| [`packages/shared/`](packages/shared/) | Matemáticas hexagonales, generador procedural determinista, tipos de dominio, definiciones del juego y Constitución (cliente + servidor) |
| [`packages/simulation/`](packages/simulation/) | **Motor del juego**: economía, mercado, CG, ONU, espionaje, guerra, revoluciones, ticks y snapshots (19 tests) |
| [`packages/api/`](packages/api/) | Backend Fastify: 40+ rutas REST (auth, economía, guerra, ONU…), WebSocket `/ws` y persistencia Memory/Postgres (16 tests) |
| [`packages/client/`](packages/client/) | Cliente web Pixi.js v8: mapa WebGL, HUD por pestañas, órdenes militares en el mapa, modales de fundación/bandera/wiki/tratados |
| [`sql/`](sql/) | Esquema PostgreSQL ejecutable (`schema.sql`) + datos de arranque (`seed.sql`) |

## 🚀 Puesta en marcha

Requisitos: Node.js ≥ 20, pnpm ≥ 10 y (opcional) PostgreSQL 16.

```bash
# 1. Instalar dependencias (una sola vez)
pnpm install

# 2a. Desarrollo completo (API en :8080 + cliente en :5173)
pnpm dev

# 2b. O solo el cliente (modo offline: genera el mundo localmente)
pnpm dev:client

# 3. Tests, tipos y build
pnpm test
pnpm typecheck
pnpm build
```

Abre `http://localhost:5173` para ver el mapa mundial interactivo.

**Persistencia y variables de entorno** (ver [`.env.example`](.env.example)):

- Sin `DATABASE_URL` → `MemoryStore` (el mundo se reinicia con el proceso; ideal para desarrollo y preview).
- Con `DATABASE_URL` → `PostgresStore` (aplicar antes `sql/schema.sql` + `sql/seed.sql`).
- `TICK_SECONDS` controla la duración del Tick económico (600 s en producción, 45 s en desarrollo).
- `JWT_SECRET` firma las sesiones (cámbialo en producción).

```bash
createdb dce_global_country
psql dce_global_country -f sql/schema.sql -f sql/seed.sql
# y arrancar con:
DATABASE_URL=postgres://localhost:5432/dce_global_country pnpm dev
```

## 🎮 Qué puedes hacer ahora (Alpha v1.0)

- **Crear cuenta / entrar** (botón "🔑 Entrar") y **fundar una nación** en tierra libre de la frontera: nombre, color, **bandera con capas** (patrón, 2 colores, emblema) y **Constitución** de 4 pilares con buffs/debuffs reales.
- **Ciudadanía**: únete a cualquier país (el fundador aprueba), trabaja en edificios, cobra salario, emigra… o únete a la rebelión e intenta un **golpe de estado** si la felicidad se hunde.
- **Economía**: construye edificios Tier 1–3, produce cadenas (mineral → acero → armas), compra y vende en el **mercado global** (oferta/demanda, spread) o en el **mercado negro**, gestiona la **moneda local** (PIB/CG) y sobrevive a las **crisis del Crédito Global**.
- **Diplomacia**: tratados (no agresión, libre comercio, defensa mutua), **Asamblea Global/ONU** con votación ponderada por PIB, embargos, espionaje (4 misiones) y el botón rojo: **Estado Paria**.
- **Guerra hex a hex**: recluta infantería/tanques/artillería, selecciona un ejército en el mapa y ordena mover o atacar; suministros ligados a la capital; cierra la guerra con paz blanca, anexión, indemnización o **estado títere** (tributo 30%).
- **En vivo**: noticias, fundaciones, guerras y ticks por WebSocket, con el contador de Tick sincronizado en el HUD.

## 📖 Documentación

| Documento | Contenido |
| --- | --- |
| [00-GDD](docs/00-GDD.md) | Game Design Document completo (copia canónica en el repo) |
| [01-Arquitectura](docs/01-evaluacion-arquitectura.md) | Evaluación del stack, motor de Ticks, modelo authoritative simulation, riesgos |
| [02-Roadmap](docs/02-roadmap-sprints.md) | 8 sprints — 0 a 7 completos; queda el backlog Post-MVP |
| [03-Base de datos](docs/03-base-de-datos.md) | Esquema PostgreSQL, relaciones clave y decisiones de diseño |
| [04-Mapa hexagonal](docs/04-frontend-mapa-hexagonal.md) | Matemáticas axiales, generación procedural y render de alto rendimiento |

## 🛠️ Stack

- **Frontend:** TypeScript + Vite + Pixi.js v8 (WebGL)
- **Backend:** Node.js + Fastify + JWT + WebSocket (motor de Ticks aislado en `@dce/simulation`, listo para migrar a Go)
- **Base de datos:** PostgreSQL 16 (adaptador listo; dev usa memoria)
- **CI/CD:** GitHub Actions (tests, tipos y build en cada push)

## 📜 Changelog

Las versiones y sus cambios están en [CHANGELOG.md](CHANGELOG.md).

## 🤝 Contribuir

1. Crea una rama desde `main`.
2. Trabaja en una tarea del [backlog Post-MVP](docs/02-roadmap-sprints.md).
3. `pnpm test && pnpm typecheck && pnpm build` en verde antes del PR.
4. Abre un Pull Request — el CI lo verifica automáticamente.

*Proyecto gestionado íntegramente en GitHub: código, documentación, esquema SQL y CI.*
