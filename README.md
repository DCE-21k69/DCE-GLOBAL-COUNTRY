# 🌍 DCE Global Country

**Simulador Geopolítico de Naciones** — MMO de navegador donde los jugadores fundan países en un mapa hexagonal procedural, gestionan su economía y constitución, declaran guerras y viven como ciudadanos de las naciones de otros jugadores.

**Estado actual: Alpha v0.1** — mapa mundial procedimental renderizado en WebGL, HUD estratégico, CI y documentación técnica completa.

## 📁 Estructura del monorepo

| Ruta | Qué contiene |
| --- | --- |
| [`docs/`](docs/) | GDD canónico + los 4 entregables técnicos (arquitectura, roadmap, BD, mapa hexagonal) |
| [`packages/shared/`](packages/shared/) | Matemáticas hexagonales, generador procedural determinista y tipos de dominio (cliente + servidor) |
| [`packages/api/`](packages/api/) | Backend Fastify: `GET /api/world`, `GET /health` |
| [`packages/client/`](packages/client/) | Cliente web: mapa WebGL (Pixi.js v8), filtros, zoom/pan, inspector de hexágonos, HUD |
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

**Base de datos (opcional en el Alpha):**

```bash
createdb dce_global_country
psql dce_global_country -f sql/schema.sql -f sql/seed.sql
```

## 🎮 Qué puedes hacer ahora (Alpha v0.1)

- Ver el mundo procedural (misma seed → mismo mapa, determinista).
- Navegar: arrastrar para mover, rueda para zoom, botones para acercar/alejar.
- Cambiar entre filtros **Político / Recursos / Militar**.
- Hacer clic en cualquier hexágono para inspeccionarlo (bioma, recursos, dueño).
- Explorar los ministerios en la barra lateral (economía, defensa, diplomacia).

## 📖 Documentación

| Documento | Contenido |
| --- | --- |
| [00-GDD](docs/00-GDD.md) | Game Design Document completo (copia canónica en el repo) |
| [01-Arquitectura](docs/01-evaluacion-arquitectura.md) | Evaluación del stack, motor de Ticks, modelo authoritative simulation, riesgos |
| [02-Roadmap](docs/02-roadmap-sprints.md) | 8 sprints desde el MVP actual hasta el producto completo |
| [03-Base de datos](docs/03-base-de-datos.md) | Esquema PostgreSQL, relaciones clave y decisiones de diseño |
| [04-Mapa hexagonal](docs/04-frontend-mapa-hexagonal.md) | Matemáticas axiales, generación procedural y render de alto rendimiento |

## 🛠️ Stack

- **Frontend:** TypeScript + Vite + Pixi.js v8 (WebGL)
- **Backend:** Node.js + Fastify (motor de Ticks aislado para posible migración a Go)
- **Base de datos:** PostgreSQL 16 + Redis (chat, mercado, pub/sub — Sprint 3+)
- **CI/CD:** GitHub Actions (tests, tipos y build en cada push)

## 🤝 Contribuir

1. Crea una rama desde `main`.
2. Trabaja en un sprint del [roadmap](docs/02-roadmap-sprints.md).
3. `pnpm test && pnpm typecheck && pnpm build` en verde antes del PR.
4. Abre un Pull Request — el CI lo verifica automáticamente.

*Proyecto gestionado íntegramente en GitHub: código, documentación, esquema SQL y CI.*
