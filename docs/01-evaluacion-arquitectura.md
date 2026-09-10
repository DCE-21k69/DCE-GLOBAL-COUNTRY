# 01 — Evaluación de Arquitectura

> Entregable 1 del prompt técnico. Análisis del stack propuesto para un MMO de navegador con miles de hexágonos y cálculos concurrentes, con ajustes recomendados.

## 1. Veredicto del stack propuesto

| Componente | Propuesta del GDD | Veredicto | Notas |
| --- | --- | --- | --- |
| Frontend UI | React / Vue | ✅ **Correcto** | React 18+ (o Vue 3). La UI es un panel de control con muchos widgets de estado (HUD, ministerios, mercado); un framework reactivo reduce el coste de mantenimiento. |
| Render del mapa | Pixi.js / Phaser | ✅ **Pixi.js v8** | Pixi es un *motor de render*, Phaser un *motor de juego* completo (física, escenas) que aquí sobra. Pixi v8: WebGL2/WebGPU, batching y una API ligera. Mejor encaje para renderizar un mapa masivo dentro de una app React. |
| Backend | Node.js o Go | ⚠️ **Node.js (TypeScript) para el Alpha → migración selectiva a Go después** | Ver §2. |
| DB estado | PostgreSQL | ✅ **Correcto** | Encaja perfecto con estado relacional (países, hexágonos, tratados) y con transacciones económicas (ledger). |
| DB tiempo real | Redis | ✅ **Correcto** | Chat, mercado en vivo, colas de eventos y pub/sub entre réplicas del motor. |

**Conclusión:** el stack es sólido. Los dos puntos que requieren decisiones de ingeniería reales son (a) el modelo de estado del motor de ticks y (b) la sincronización cliente-servidor. El resto son elecciones de bibliotecas.

## 2. El problema central: el motor de Ticks

El GDD pide "cálculos concurrentes masivos" cada Tick. Aquí está el 90% del riesgo técnico del proyecto. La decisión clave no es el lenguaje: es **qué estado vive en memoria y qué estado vive en PostgreSQL**.

### 2.1. Modelo de estado recomendado (authoritative simulation)

```
                   ┌──────────────────────────────────────────────┐
                   │         MOTOR (proceso Node.js, en RAM)       │
                   │  · hexágonos, edificios, ejércitos, precios   │
                   │  · procesa Ticks (1 Tick = 10 min, en fases)  │
                   │  · publica snapshots delta por WebSocket      │
                   └──────────────┬───────────────────┬────────────┘
                     escritura    │                   │ suscripciones
                     periódica    │                   ▼
                   ┌──────────────▼─────────┐   ┌──────────────┐
                   │ PostgreSQL (verdad)    │   │ Redis (pub/sub│
                   │ snapshot + ledger      │   │ + cachés)    │
                   └────────────────────────┘   └──────┬───────┘
                                                        ▼
                                              Clientes (Pixi + WebSocket)
```

**Reglas de oro:**

1. **El motor es la autoridad.** PostgreSQL es la *fuente de verdad persistida*, pero el motor solo escribe en él por fases (cada Tick) o en eventos críticos (declaración de guerra, golpe de estado). Nunca en cada micro-operación.
2. **El motor corre en un único proceso por mundo** (en el Alpha, un solo mundo). El paralelismo no es entre procesos compartiendo estado, sino **fases internas del Tick**: producción → consumo → comercio → movimiento militar → eventos. Cada fase es un paso determinista sobre el estado en RAM.
3. **Snapshots y crash-recovery:** cada N Ticks (ej. 6) el motor persiste un snapshot completo del mundo; entre snapshots, los cambios transaccionales van a un WAL lógico (Redis Streams o tabla `ledger_entries`). Tras un crash, se restaura el último snapshot y se repliegan los eventos. Tiempo objetivo de recuperación: < 1 Tick.

### 2.2. ¿Node.js o Go?

**Recomendación: empezar con Node.js + TypeScript y aislar el motor tras una interfaz de "Simulación".**

- **A favor de Node.js (fase Alpha/MVP):** un solo lenguaje en todo el repo (`@dce/shared` se comparte con el cliente, incluidas las matemáticas hexagonales y el generador procedural); los ticks se procesan de forma asíncrona en fases y, para el tamaño del Alpha (≈300-2000 hexágonos, decenas de países), el throughput de Node es más que suficiente. El equipo itera 2-3× más rápido.
- **Cuándo migrar a Go:** cuando un Tick exceda su presupuesto (p. ej. >30 s para 10k+ hexágonos con pathfinding A* por ejército) o cuando haya que servir >1 mundo por proceso. En ese punto se reimplementa **solo el módulo del motor** (`simulation/`) en Go, manteniendo el mismo protocolo (gRPC o Redis Streams) y el mismo esquema PostgreSQL. El resto del backend (REST, autenticación, websockets de envío) puede seguir en Node.
- La regla de diseño que hace esto posible: **la simulación se comunica con el exterior solo por eventos serializables** (JSON/Protobuf), nunca por objetos compartidos.

### 2.3. Presupuesto de rendimiento (objetivos cuantificables)

| Métrica | Objetivo Alpha | Objetivo v1.0 |
| --- | --- | --- |
| Hexágonos activos | 500–2 000 | 50 000+ (particionados por chunk) |
| Jugadores concurrentes | 100 | 5 000 |
| Duración de un Tick | < 2 s (server) | < 30 s (en Go si hace falta) |
| Tick rate | 10 min | 5–10 min (ajustable) |
| Latencia de evento → cliente | < 200 ms | < 200 ms |
| Frame rate del mapa | 60 fps con 5k hexágonos visibles | 60 fps con culling por chunks |
| Recuperación tras crash | < 1 Tick | < 1 Tick |

## 3. Arquitectura por servicios (v1.0 objetivo)

```
                    ┌─────────────────────────────────────────────┐
                    │                 CDN + Edge                  │
                    └──────────────┬──────────────────────────────┘
        ┌──────────────────────────┼──────────────────────────────┐
        ▼                          ▼                              ▼
┌───────────────┐   ┌──────────────────────┐   ┌──────────────────────────┐
│ API Gateway   │   │ WebSocket Gateway    │   │ Cliente web (React+Pixi) │
│ (Fastify)     │──▶│ (pub/sub Redis)      │◀──│ · mapa WebGL             │
│ auth, REST    │   │ canales: mundo, país │   │ · UI panel de control    │
└──────┬────────┘   └──────────┬───────────┘   └──────────────────────────┘
       │                       │
       ▼                       ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────┐
│ MOTOR DE SIMULACIÓN (por mundo)      │   │ PostgreSQL 16                │
│ · estado en RAM + snapshot           │──▶│ · verdad persistida          │
│ · fases del Tick                     │   │ · ledger (transacciones)     │
│ · determinista (seed del mundo)      │   │ · eventos de dominio         │
└──────────────┬───────────────────────┘   └──────────────────────────────┘
               │ eventos / colas
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Redis 7                                                                  │
│ · pub/sub de eventos (chat, mercado, tick)  · cachés calientes (prices)  │
│ · Streams como WAL lógico entre snapshots   · rate limiting y sesiones   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Decisiones importantes de este diseño:**

1. **Fastify en lugar de Express** en Node: rendimiento comparable a Go para I/O ligero, schema validation y plugins de websocket maduros.
2. **Determinismo como herramienta de testeo:** mismo seed → mismo mundo → los ticks pueden *reproducirse* en CI. Esto convierte bugs de economía/combate en tests unitarios deterministas.
3. **Un snapshot por mundo, no por jugador:** el cliente guarda el estado que necesita; el motor no mantiene estado por conexión (solo suscripciones en el gateway).
4. **El mapa se carga una vez y muta por deltas:** el cliente renderiza el mundo entero al entrar y después aplica parches incrementales (`{hex: (3,1), countryId: X, buildings:[...]}`). Así, 5 000 clientes viendo el mismo frente no multiplican el tráfico.

## 4. Modelo de datos de alto nivel (resumen)

Detalle completo en [03 — Base de datos](03-base-de-datos.md). Resumen:

- `users`, `countries`, `constitutions`, `citizenships` → identidad y ciudadanía (GDD §3, §5).
- `hexagons` → mapa con clave única `(world_id, q, r)`; la geometría nunca se guarda, se calcula con la función axial→píxel de `@dce/shared`.
- `currencies`, `ledger_entries` → CG y monedas locales; el ledger es append-only (auditoría + rollback).
- `buildings`, `inventories` → producción Tier 1–3 (GDD §4.2).
- `treaties`, `wars`, `armies`, `espionage_missions` → diplomacia y conflicto (GDD §6).
- `assembly_proposals`, `assembly_votes` → la "ONU" con voto ponderado.

## 5. Riesgos técnicos principales (y mitigación)

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Tick lento cuando el mundo crezca | Alto | Fases paralelas internas, particionar mundo en chunks, migrar motor a Go si se alcanza el presupuesto (§2.2). |
| Trampas / clientes manipulados | Alto | El servidor es la autoridad absoluta; el cliente solo envía *intenciones* (órdenes) y renderiza. Validación de toda orden contra el estado del motor. |
| Estado inconsistente tras crash | Alto | Snapshot periódico + WAL lógico (Redis Streams) + tests de repliege en CI. |
| DDoS / cuentas bot | Medio | Rate limiting por IP+cuenta (Redis), captcha en registro, shadowban de bots que no juegan. |
| Economía rota por explotadores | Medio | Simulaciones offline deterministas del motor contra datasets grabados (replay). |
| Latencias en el render con mapas gigantes | Medio | Culling por viewport + chunks estáticos + texturas atlas (detalle en doc 04). |

## 6. Qué no construir todavía (anti-YAGNI)

- No Kubernetes en el Alpha: un solo proceso del motor + Docker Compose (Postgres + Redis + API + motor) es suficiente.
- No microservicios: un monorepo con módulos bien delimitados (`packages/shared`, `packages/api`, `packages/client`, futuro `packages/simulation`) da el 90% del beneficio.
- No física de movimiento de tropas continua: las unidades se mueven por hexágono y Tick (decisión de diseño que simplifica enormemente el netcode).
