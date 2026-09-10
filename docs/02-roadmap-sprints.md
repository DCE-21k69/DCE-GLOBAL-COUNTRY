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

## Sprint 1 — Autenticación y Fundación de Naciones

**Objetivo:** los usuarios existen, entran, y fundan países reales en el mapa.

- Registro/login (argon2id + JWT + cookies httpOnly), validación y rate limiting.
- `POST /api/countries` — fundar nación en tierra libre (10–20 hexágonos iniciales, forma irregular según GDD §2), eligiendo nombre + bandera (SVG sanitizado).
- Persistencia: tablas `users`, `countries`, `hexagons` del esquema (ver doc 03).
- Wiki Nacional v0: página pública de país con historia (Markdown sanitizado), aliados y PIB (GDD §3.1).
- Frontend: pantalla de registro, modal de fundación, colores reales del país en el mapa.

**DoD:** un usuario nuevo puede crear cuenta, fundar país en el borde del mundo y verlo coloreado en el mapa de todos los clientes conectados (WebSocket).

---

## Sprint 2 — Constitución, Ciudadanía y Trabajo

**Objetivo:** las mecánicas sociales más básicas del GDD §3.2 y §5.

- Editor de Constitución con los 4 pilares y sus buffs/debuffs aplicados por el motor (los efectos viven en el motor como reglas declarativas).
- Sistema de ciudadanía: unirse a un país, roles (`worker`, `entrepreneur`, `soldier`, `minister`), con permisos.
- Trabajo: los ciudadanos se asignan a edificios; sueldo fijado por el fundador/mercado; emigración si el sueldo es bajo.
- Felicidad y salud básicas (consumo de comida por Tick).

**DoD:** un país con 5 ciudadanos produce según su Constitución; la elección democracia vs autocracia produce diferencias medibles en los Ticks.

---

## Sprint 3 — Economía: producción, CG y mercado

**Objetivo:** la cadena económica del GDD §4.

- Motor de Ticks real (fases: producción → consumo → comercio → movimientos), 1 Tick = 10 min.
- Edificios Tier 1 (granja/mina/pozo), Tier 2 (fundición/refinería) y Tier 3 (armamento/bienes) con inputs/outputs declarativos.
- Mercado global en CG con libro de órdenes (Redis), precios por oferta/demanda.
- Monedas locales: valor ligado a PIB y reservas de CG (fórmula del doc 03).
- Estados del CG: crisis/deflación/guerra comercial como máquina de estados global.
- Logística: carreteras; cortar la ruta a la capital paraliza el hexágono (BFS por el grafo de hexes).

**DoD:** una cadena completa mina→fundición→fábrica produce y vende en el mercado; una crisis de CG provoca inflación visible en los precios del HUD.

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
