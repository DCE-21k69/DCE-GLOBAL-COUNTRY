# 02 — Roadmap de Desarrollo (Sprints)

> Entregable 2 del prompt técnico. Hoja de ruta hacia un MVP jugable, en sprints de 2 semanas. Los sprints marcados con ✅ ya tienen código en este repositorio.

## Principios del roadmap

1. **Vertical slices, no capas horizontales:** cada sprint termina con algo *jugable y visible*, no con "el backend listo".
2. **El motor es el corazón:** se construye desde el Sprint 1 (generador determinista) para que todo lo demás cuelgue de él.
3. **La economía antes que la guerra:** una guerra sin economía es un juego de clicks; la economía sin guerra ya es un juego.
4. **Cut line móvil:** si un sprint se atasca, se recorta alcance (p. ej. espionaje → Sprint 7), nunca se alargan los sprints.

---

## Sprint 0 — Cimientos del monorepo ✅ *(entregado en este repo)*

**Objetivo:** estructura técnica, mapa hexagonal visible y CI funcionando.

- ✅ Monorepo pnpm: `packages/shared`, `packages/api`, `packages/client`.
- ✅ `@dce/shared`: coordenadas axiales (q,r), distancias, pixel↔hex, generador procedural **determinista** (misma seed → mismo mundo), biomas, recursos.
- ✅ Backend Fastify: `GET /health`, `GET /api/world` con caché.
- ✅ Cliente Pixi.js v8: render WebGL con culling, pan/zoom anclado al cursor, filtros Político/Recursos/Militar, inspector de hexágonos, HUD.
- ✅ CI de GitHub Actions: lint de tipos, tests y build en cada push/PR.
- ✅ Documentación técnica completa (docs/01–04).

**Definition of Done:** el mundo se renderiza a 60 fps con 300+ hexágonos; tests verdes en CI; `pnpm dev` levanta API+cliente.

---

## Sprint 1 — Autenticación y Fundación de Naciones ✅ *(entregado en v0.2)*

**Objetivo:** los usuarios existen, entran, y fundan países reales en el mapa.

- ✅ Registro/login con scrypt + JWT (ruta `/api/auth/*`), validación de credenciales.
- ✅ `POST /api/countries` — fundar nación en tierra libre de la frontera (10-15 hexágonos irregulares, GDD §2), con nombre + color + Constitución.
- ✅ Persistencia con doble adaptador: `MemoryStore` (dev/tests) y `PostgresStore` (producción, `DATABASE_URL`), tras la interfaz `Store`.
- ✅ Propiedad del territorio persistida en `country_hexes` (ver doc 03).
- ✅ WebSocket `/ws`: la fundación de un jugador aparece en el mapa de **todos** los clientes en tiempo real.
- ✅ Frontend: registro/login, modal de fundación con preview de buffs/debuffs, colores reales en el mapa.
- ⏳ Pendiente de este sprint: Wiki Nacional v0 (historia comunitaria) y rate limiting → se retoman en el Sprint 2.

**DoD:** ✅ un usuario nuevo crea cuenta, funda país en el borde del mundo y lo ve coloreado en el mapa de todos los clientes conectados (WebSocket).

---

## Sprint 2 — Constitución, Ciudadanía y Trabajo

**Objetivo:** las mecánicas sociales más básicas del GDD §3.2 y §5.

- ✅ (adelantado en v0.2) Editor de Constitución con los 4 pilares y sus buffs/debuffs aplicados por el motor.
- Sistema de ciudadanía: unirse a un país, roles (`worker`, `entrepreneur`, `soldier`, `minister`), con permisos.
- Trabajo: los ciudadanos se asignan a edificios; sueldo fijado por el fundador/mercado; emigración si el sueldo es bajo.
- Felicidad y salud básicas (consumo de comida por Tick).
- Wiki Nacional v0 (historia comunitaria) y rate limiting pendientes del Sprint 1.

**DoD:** un país con 5 ciudadanos produce según su Constitución; la elección democracia vs autocracia produce diferencias medibles en los Ticks.

---

## Sprint 3 — Economía: producción, CG y mercado 🚧 *(núcleo entregado en v0.2)*

**Objetivo:** la cadena económica del GDD §4.

- ✅ Motor de Ticks real (`packages/simulation`): producción → consumo → impuestos, cada Tick (10 min en producción, 45 s en dev).
- ✅ Producción Tier 1 por biomas/recursos de los hexágonos propios, con los efectos de la Constitución aplicados (planificada/libre mercado/conscripción).
- ✅ Consumo de comida por ciudadano con evento de hambruna (GDD §5).
- ✅ Inventarios persistentes (tabla `inventories` / MemoryStore) y HUD con recursos reales.
- ⏳ Pendiente: edificios Tier 1-3 explícitos, mercado global con libro de órdenes (Redis), monedas locales ligadas al PIB, estados del CG (crisis/deflación/guerra comercial) y logística (carreteras).

**DoD parcial:** ✅ la producción depende del territorio y de la Constitución y se acumula tick a tick; los precios de mercado y la cadena Tier 2/3 llegan con el resto del sprint.

---

## Sprint 4 — Diplomacia, Asamblea Global y Mercado Negro

**Objetivo:** las capas "social" y "clandestina" del GDD §6.2–6.3.

- Tratados formales aplicados por el servidor: no agresión, libre comercio, defensa mutua.
- Asamblea Global: propuestas, votación ponderada por PIB/población, leyes mundiales (embargos, impuestos).
- Botón rojo: retirarse de la Asamblea → Estado Paria (pierde mercado global, opera en mercado negro).
- Mercado Negro: compra/venta anónima con precios inflados; financiar rebeliones en países vecinos.
- Espionaje v0: misión de reconocimiento (revelar tropas enemigas).

**DoD:** la Asamblea aprueba un embargo; el país embargado compra acero solo vía mercado negro con sobreprecio.

---

## Sprint 5 — Guerra hexágono por hexágono

**Objetivo:** el combate del GDD §6.1.

- Reclutamiento con las dos doctrinas militares (conscripción vs profesional).
- Unidades: infantería (ocupa), tanques (rompen defensa), artillería (daña infraestructura); movimiento por hexágono y Tick.
- Líneas de suministro: pathfinding a la capital; tropas rodeadas pierden suministro y se rinden.
- Defensa por terreno/bioma y resolución de combate determinista (testeable en CI).
- Tratados de paz: anexión, indemnización en CG, cambio de gobierno, estado títere (tributo 30%).

**DoD:** una guerra completa entre dos países demo termina con un tratado de paz y el territorio anexado visible en el mapa.

---

## Sprint 6 — Revoluciones, Ministerios y Wiki completa

**Objetivo:** cerrar el bucle político del GDD §5.

- Descontento → partidos rebeldes → compra de armas (mercado negro) → golpe de estado militar.
- Ministerios delegados con permisos reales (economía, defensa, exterior).
- Wiki Nacional completa: historia comunitaria, tratados, moneda, PIB.
- Notificaciones y newsfeed del Dashboard.

**DoD:** un golpe de estado exitoso cambia al fundador de un país sin intervención de staff.

---

## Sprint 7 — Pulido, balance y MVP público

**Objetivo:** producto mínimo viable para jugadores reales.

- Balance económico (simulaciones offline con replay del motor).
- Creador de banderas con capas y validación (GDD §3.1).
- Optimización de render (chunks estáticos, texturas atlas) y CDN.
- Observabilidad: métricas (Prometheus), logs estructurados, dashboard de salud de Ticks.
- **MVP listo:** fundar → producir → comerciar → aliarse → guerrear.

---

## Post-MVP (backlog priorizado)

1. Migración del motor a Go si el Tick excede presupuesto (doc 01 §2.2).
2. Particionado del mundo en chunks + sharding por mundo.
3. Bloques geopolíticos tipo OTAN con economía compartida.
4. Eventos mundiales (hambrunas, descubrimientos de petróleo).
5. App móvil (PWA) — el mapa WebGL escala bien a tablets.

---

### Criterio de "Definition of Ready" por sprint

- Historias con criterios de aceptación medibles (los "DoD" de arriba).
- Migraciones de SQL versionadas (se añade `sql/migrations/` en el Sprint 1).
- Riesgo técnico identificado (tabla del doc 01 §5) con mitigación.
