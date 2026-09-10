# 🌍 DCE Global Country

**Simulador Geopolítico de Naciones** — MMO de navegador donde los jugadores fundan países en un mapa hexagonal procedural, gestionan su economía y constitución, declaran guerras y viven como ciudadanos de las naciones de otros jugadores.

**Estado actual: Alpha v0.2** — cuentas de usuario, fundación de naciones en el mapa (con Constitución y buffs/debuffs reales), motor de Ticks económicos, persistencia con doble adaptador (memoria/PostgreSQL), eventos en vivo por WebSocket y CI.

## 📁 Estructura del monorepo

| Ruta | Qué contiene |
| --- | --- |
| [`docs/`](docs/) | GDD canónico + los 4 entregables técnicos (arquitectura, roadmap, BD, mapa hexagonal) |
| [`packages/shared/`](packages/shared/) | Matemáticas hexagonales, generador procedural determinista, Constitución y tipos de dominio (cliente + servidor) |
| [`packages/simulation/`](packages/simulation/) | **Motor del juego**: estado del mundo en RAM, fundación de naciones y Ticks económicos |
| [`packages/api/`](packages/api/) | Backend Fastify: auth (JWT), `POST /api/countries`, `/api/world`, `/api/me`, WebSocket `/ws` |
| [`packages/client/`](packages/client/) | Cliente web: mapa WebGL (Pixi.js v8), login/registro, fundación de naciones, panel "Mi País", HUD en vivo |
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

## 🎮 Qué puedes hacer ahora (Alpha v0.2)

- **Crear cuenta / entrar** (botón "🔑 Entrar" en la barra superior).
- **Fundar una nación**: haz clic en un hexágono gris de la frontera y pulsa "🏛️ Fundar nación aquí". Elige nombre, color y **Constitución** (gobierno, economía, doctrina militar, migración) con sus buffs/debuffs.
- Ver tu nación en el panel **"Mi País"**: reservas, población, hexágonos y constitución.
- **Economía viva**: cada Tick tu territorio produce comida, hierro, carbón, piedra y petróleo según sus biomas y tu constitución; tu población consume comida y paga impuestos en Crédito Global.
- Ver en **tiempo real** las naciones que fundan otros jugadores (WebSocket).
- Navegar el mapa: filtros Político/Recursos/Militar, zoom, arrastre e inspector de hexágonos.

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
- **Backend:** Node.js + Fastify + JWT + WebSocket (motor de Ticks aislado en `@dce/simulation`, listo para migrar a Go)
- **Base de datos:** PostgreSQL 16 (adaptador listo; dev usa memoria) + Redis (chat, mercado, pub/sub — Sprint 3+)
- **CI/CD:** GitHub Actions (tests, tipos y build en cada push)

## 📜 Changelog

Las versiones y sus cambios están en [CHANGELOG.md](CHANGELOG.md).

## 🤝 Contribuir

1. Crea una rama desde `main`.
2. Trabaja en un sprint del [roadmap](docs/02-roadmap-sprints.md).
3. `pnpm test && pnpm typecheck && pnpm build` en verde antes del PR.
4. Abre un Pull Request — el CI lo verifica automáticamente.

*Proyecto gestionado íntegramente en GitHub: código, documentación, esquema SQL y CI.*
