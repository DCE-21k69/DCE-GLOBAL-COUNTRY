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

## Sprint 2 — Constitución, Ciudadanía y Trabajo ✅ *(entregado en v1.0)*

**Objetivo:** las mecánicas sociales más básicas del GDD §3.2 y §5.

- ✅ Editor de Constitución con los 4 pilares (`government`, `economy`, `militaryDoctrine`, `migrationPolicy`) y sus buffs/debuffs aplicados por el motor.
- ✅ Ciudadanía: unirse a un país (adhesión aprobada por el fundador), emigrar, roles (`worker`, `entrepreneur`, `soldier`, `minister`).
- ✅ Trabajo: los ciudadanos se asignan a edificios (+8% producción por obrero, máx. +50%); sueldo fijado por el fundador.
- ✅ Felicidad por país (comida, constitución, guerra, hambruna) — base de la revolución (Sprint 6).
- ✅ Wiki Nacional v0: lema, historia, PIB, población, moneda (editable por el fundador).
- ✅ Creador de banderas con capas (patrón + 2 colores + emblema) con preview SVG y render final.

**DoD:** ✅ un país con ciudadanos produce según su Constitución; democracia vs autocracia y conscripción vs profesional producen diferencias medibles en los Ticks (testeado en el motor).

---

## Sprint 3 — Economía: producción, CG y mercado ✅ *(entregado en v1.0)*

**Objetivo:** la cadena económica del GDD §4.

- ✅ Motor de Ticks real: producción → consumo → impuestos, cada Tick (10 min en producción, 45 s en dev), con `serialize()`/`hydrate()` para snapshots.
- ✅ Producción Tier 1 por biomas/recursos y efectos de la Constitución.
- ✅ Edificios explícitos Tier 1–3 (`farm`, `mine`, `well`, `foundry`, `refinery`, `arms_factory`, `consumer_industry`) con cadenas de producción.
- ✅ Mercado global con cotizaciones de oferta/demanda y spread (5%); compra/venta de recursos y productos derivados (acero, combustible, armas, bienes).
- ✅ Mercado negro: compra anónima con sobreprecio (×1.8, ×2.2 si eres Estado Paria) y venta de armas a rebeliones.
- ✅ Monedas locales: tasa de cambio PIB/CG por país (fuerte/débil según PIB).
- ✅ Estados del CG: estable, crisis (inflación, caída de PIB), deflación, guerra comercial — con recuperación automática por ticks.
- ✅ Logística: líneas de suministro de ejércitos a la capital; tropas rodeadas sin suministro.
- ✅ Consumo de comida y eventos de hambruna.

**DoD:** ✅ producción por territorio/Constitución acumulada tick a tick; mercado con oferta-demanda; un país sancionado compra solo vía mercado negro con sobreprecio.

---

## Sprint 4 — Diplomacia, Asamblea Global y Mercado Negro ✅ *(entregado en v1.0)*

**Objetivo:** las capas "social" y "clandestina" del GDD §6.2–6.3.

- ✅ Tratados formales aplicados por el servidor: `no_aggression`, `free_trade`, `mutual_defense` (propuesta + aceptación + cancelación).
- ✅ Asamblea Global (ONU): propuestas, votación ponderada por PIB, cuotas de membresía, retirarse/reincorporarse.
- ✅ Estado Paria: al retirarse de la Asamblea pierde el mercado global y opera en mercado negro con sobreprecio.
- ✅ Embargos aprobados por la Asamblea con votación (necesitan mayoría ponderada).
- ✅ Espionaje con 4 misiones: revelar inventarios, sabotear un edificio, revelar ejércitos, contrainteligencia.

**DoD:** ✅ la Asamblea aprueba una propuesta por votación ponderada; el país paria compra solo vía mercado negro.

---

## Sprint 5 — Guerra hexágono por hexágono ✅ *(entregado en v1.0)*

**Objetivo:** el combate del GDD §6.1.

- ✅ Declaración de guerra formal (cuesta 1000 CG) + motivo; guerras persistentes en `/api/wars`.
- ✅ Reclutamiento con las dos doctrinas (conscripción ×0.5 coste, profesional calidad plena).
- ✅ Unidades: infantería (ocupa), tanques (rompen defensa), artillería (bombardeo); movimiento y ataque hex a hex desde el mapa (clic + resaltado de vecinos).
- ✅ Defensa por terreno/bioma, ratio de combate 1.3/0.77 y resolución determinista (testeada en CI).
- ✅ Líneas de suministro: pathfinding a la capital; sin suministro las tropas sufren desgaste.
- ✅ Tratados de paz: `white_peace`, `annex`, `indemnity`, `puppet` — estado títere con tributo del 30% de producción y gobierno impuesto.

**DoD:** ✅ una guerra completa entre dos países demo termina con un tratado de paz y el territorio anexado visible en el mapa (tests de motor).

---

## Sprint 6 — Revoluciones, Ministerios y Wiki completa ✅ *(entregado en v1.0)*

**Objetivo:** cerrar el bucle político del GDD §5.

- ✅ Descontento (felicidad baja) → rebelión con fuerza creciente → golpe de estado.
- ✅ Golpe exitoso transfiere la fundación (el rebelde pasa a ser `foundedBy`) sin intervención de staff.
- ✅ Ministerios: nombrar/cesar ministros con rol `minister` (permisos reales de edición de Wiki).
- ✅ Wiki Nacional completa: lema, historia, moneda, PIB.
- ✅ Newsfeed del Dashboard (`/api/news`) + notificaciones en vivo por WebSocket (`news`, `famine`).

**DoD:** ✅ un golpe de estado exitoso cambia al fundador de un país (test del motor).

---

## Sprint 7 — Pulido, balance y MVP público ✅ *(entregado en v1.0)*

**Objetivo:** producto mínimo viable para jugadores reales.

- ✅ Creador de banderas con capas y validación (GDD §3.1) + preview SVG en directo.
- ✅ HUD completo y navegación por pestañas: Dashboard / Mi País / Economía / Defensa / Diplomacia / Ciudadanía.
- ✅ Órdenes militares desde el mapa (seleccionar ejército → mover/atacar en hex adyacente).
- ✅ Persistencia por snapshots: cada acción y cada tick persisten el estado del motor (Memory/Postgres).
- ✅ Toasts y eventos en vivo (fundaciones, guerras, noticias, ticks) por WebSocket.
- ✅ Optimización de render (Pixi v8 WebGL con culling, marcadores por `toGlobal`).
- ⏳ Diferido a Post-MVP: balance offline con replays, métricas Prometheus, CDN.

**MVP listo:** ✅ fundar → producir → comerciar → aliarse → guerrear.

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
