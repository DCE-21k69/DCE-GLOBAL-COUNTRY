# 03 — Arquitectura de Base de Datos

> Entregable 3 del prompt técnico. Esquema PostgreSQL con tablas principales, relaciones clave y decisiones de diseño. El SQL ejecutable vive en [`sql/schema.sql`](../sql/schema.sql).

## 1. Diagrama entidad-relación (versión textual)

```
users ─┬─ citizenships ─── countries ──┬─ constitutions (1:1)
       │                 ▲             ├─ ministries (1:N)
       │                 │             ├─ inventories (1:N por recurso)
       │  ministries ─────┘             ├─ currencies (1:1 moneda local)
       │                               ├─ governments (1:1)
       │                               └─ hexagons (1:N territorio)
       │
worlds ─── hexagons ─── buildings (1:N)
   │          │
   │          └── armies (posición)
   │
currencies (CG global = country_id NULL) ── ledger_entries (1:N, append-only)
countries ── treaties (N:M consigo mismo, CHECK a≠b)
countries ── wars (aggressor/defender)
countries ── assembly_proposals / assembly_votes (N:M ponderado)
users ────── espionage_missions (spy) → countries (target)
```

## 2. Tablas principales

### 2.1. Identidad y ciudadanía (GDD §3, §5)

| Tabla | Propósito | Claves |
| --- | --- | --- |
| `users` | Cuentas reales. `username`/`email` con `CITEXT` (case-insensitive). | PK `id` UUID |
| `countries` | Nación fundada. `flag_svg` sanitizado (GDD §3.1), `is_pariah` (retirado de la ONU, §6.3), `is_puppet_of` + `puppet_tribute` (estado títere, §6.1). | PK `id` UUID, UNIQUE `(world_id, name)` |
| `constitutions` | Los 4 pilares elegidos (GDD §3.2). Los **efectos** (buffs/debuffs) son reglas del motor, no datos — así el balance se ajusta sin migraciones. | PK/FK `country_id` |
| `citizenships` | Usuario viviendo en un país con rol y stats (`health`, `happiness`). PK compuesta `(user_id, country_id)` → permite doble nacionalidad o exilio sin migrar. | PK `(user_id, country_id)` |

### 2.2. Mapa (GDD §2)

| Tabla | Propósito | Claves |
| --- | --- | --- |
| `worlds` | Un reino persistente. En el Alpha hay uno solo; en v1.0, varios mundos = sharding natural. | PK `id` SMALLINT |
| `hexagons` | Cada celda: `(world_id, q, r)` axiales, bioma, elevación, `country_id` dueño. **La geometría (píxeles) no se almacena jamás**: se calcula en `@dce/shared` (doc 04). | UNIQUE `(world_id, q, r)`; índices de consulta espacial y por dueño. |

### 2.3. Economía (GDD §4)

| Tabla | Propósito | Claves |
| --- | --- | --- |
| `currencies` | El CG (`is_global=TRUE`, `country_id NULL`) y las monedas locales (1 por país). | PK `code` |
| `ledger_entries` | **Apéndice inmutable** de toda transacción monetaria (comercio, salarios, impuestos, botín, robos de espías). Permite auditoría, rollback y analítica de balance. | índice `(country_id, created_at DESC)` |
| `inventories` | Stocks por país y recurso (Tier 1–3 + CG). En el motor viven en RAM; esta tabla es su persistencia por Tick. | PK `(country_id, resource)` |
| `buildings` | Edificios anclados a un hexágono con `tier` (1–3) y `level`. | UNIQUE `(hex_id, type)` |

**Fórmula del valor de moneda local** (se implementará en el motor, Sprint 3):

```
valor_local = f(PIB / población, reservas_CG / deuda_total)
PIB = Σ(producción de hexágonos × precios de mercado)
```

### 2.4. Diplomacia y conflicto (GDD §6)

| Tabla | Propósito | Claves |
| --- | --- | --- |
| `treaties` | No agresión, libre comercio, defensa mutua, paz, títere. `CHECK (country_a <> country_b)`. | PK `id` |
| `wars` | Conflicto activo con `status`. | PK `id` |
| `armies` | Unidad con `unit_type` (infantería/tanque/artillería), posición `hex_id` y `supply_line` (bool que recalcula el motor: ¿hay ruta segura a la capital?). | índice `(hex_id)` |
| `espionage_missions` | Misiones de espía: `recon`, `sabotage`, `heist` (robo de CG), `proxy_war`. | PK `id` |
| `assembly_proposals` / `assembly_votes` | La ONU: propuestas con `closes_at` y votos con `weight` (PIB/población) calculado por el motor al emitir el voto. | PK `(proposal_id, country_id)` |

### 2.5. Gobierno (GDD §5)

| Tabla | Propósito |
| --- | --- |
| `ministries` | Ministros delegados por portfolio (economía, defensa, exterior). PK `(country_id, portfolio)` → un ministro por cartera. |
| `governments` | Quién gobierna (`leader_user`) y tipo de régimen (autocracia, democracia, régimen títere). |

## 3. Decisiones de diseño clave

1. **UUIDs para entidades de dominio** (países, usuarios): se generan en la app sin roundtrip, no chocan entre mundos y simplifican el sharding futuro. Los IDs numéricos (`BIGINT IDENTITY`) se reservan para tablas de alta rotación (hexágonos, ledger, ejércitos) que se particionan mejor con rangos numéricos.
2. **Dinero = `NUMERIC(20,4)`, nunca `DOUBLE PRECISION`.** Los errores de redondeo flotante en un ledger son inaceptables.
3. **Ledger append-only:** no se hacen `UPDATE` sobre saldos históricos; los saldos son proyecciones (suma del ledger). La tabla `inventories` guarda la proyección cacheada por Tick para lecturas baratas.
4. **CITEXT** para identificadores legibles (usernames, emails) — evita duplicados tipo `Player` vs `player`.
5. **Índices pensados para los queries calientes del juego:**
   - `hexagons (world_id, q, r)` → clic en el mapa, vecinos (la pantalla hace 7 lookups O(1)).
   - `hexagons (country_id) WHERE country_id IS NOT NULL` → reconstrucción de territorio.
   - `ledger_entries (country_id, created_at DESC)` → extractos y analítica.
   - `armies (hex_id)` → ¿quién hay en este frente?
6. **Integridad de estados por CHECK** (enums de roles, biomas, tipos de tratado) — el motor no puede escribir basura ni siquiera por bug.
7. **La geometría nunca se persiste.** Solo `(q, r)` axiales. Menos datos, imposibilidad de incoherencia cliente/servidor.

## 4. Estrategia de escritura del motor (flujo Tick)

```
Tick N comienza
  1. Motor carga estado en RAM (o ya lo tiene del tick anterior)
  2. Fases: producción → consumo → comercio → movimiento → eventos
  3. Persistencia por lotes (batch INSERT):
       - ledger_entries (transacciones del tick)
       - inventories (saldos proyectados)
       - hexagons.owner / armies.hex_id (cambios de territorio)
  4. Publica delta del Tick a Redis pub/sub
Tick N termina (presupuesto: < 2 s)
```

Snapshots completos cada 6 ticks; entre medias, el WAL lógico (Redis Streams) permite replegar eventos tras un crash (doc 01 §2.1).

## 5. Escalado previsto

| Fase | Datos estimados | Acción |
| --- | --- | --- |
| Alpha | 2 000 hexes, 100 jugadores | Un solo Postgres; el esquema ya es el definitivo. |
| v1.0 | 50 000 hexes, 5 000 CCU | Particionar `hexagons` y `ledger_entries` por `world_id`/rango; réplica de lectura para la Wiki y analítica. |
| Multi-mundo | N× lo anterior | Un esquema por mundo (sharding por `world_id`) o Citus si se unifica. |

> **Cómo probarlo en local:** `createdb dce_global_country && psql dce_global_country -f sql/schema.sql -f sql/seed.sql`
