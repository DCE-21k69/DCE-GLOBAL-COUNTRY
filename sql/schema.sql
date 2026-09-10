# ============================================================================
# DCE Global Country — Esquema PostgreSQL (Alpha)
#
# Cómo aplicarlo:
#   createdb dce_global_country
#   psql dce_global_country -f sql/schema.sql
#
# Convenciones:
#   · PKs: UUID (generados por la app) → particionado y escalado horizontal.
#   · Timestamps: timestamptz (UTC) + trigger de actualización.
#   · IDs numéricos: BIGINT GENERATED ALWAYS AS IDENTITY.
#   · Moneda: NUMERIC(20,4) — nunca floats para dinero.
# ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- CITEXT (case-insensitive text)

-- ── Trigger para `updated_at` ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- IDENTIDAD Y MUNDO
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      CITEXT UNIQUE NOT NULL,           -- case-insensitive
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                    -- argon2id
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

-- Mundo persistente: en producción habrá uno solo (o shards por reino).
CREATE TABLE worlds (
  id          SMALLINT PRIMARY KEY,
  name        TEXT NOT NULL,
  seed        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- PAÍSES, CONSTITUCIÓN Y CIUDADANÍA
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE countries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id       SMALLINT NOT NULL REFERENCES worlds(id),
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#3b82f6',  -- color del mapa (#rrggbb)
  flag_json      JSONB NOT NULL DEFAULT '{}'::jsonb, -- bandera por capas (GDD §3.1)
  population     INTEGER NOT NULL DEFAULT 100,
  cap_q          INT,                              -- capital: coordenada axial q
  cap_r          INT,                              -- capital: coordenada axial r
  founded_by     UUID REFERENCES users(id),
  founded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_pariah      BOOLEAN NOT NULL DEFAULT FALSE,  -- se retiró de la Asamblea (GDD §6.3)
  is_puppet_of   UUID REFERENCES countries(id),   -- estado títere (GDD §6.1)
  puppet_tribute NUMERIC(5,2) DEFAULT 0,          -- % de recursos al amo (0-100)
  UNIQUE (world_id, name)
);

-- Constitución: pilares iniciales (GDD §3.2). Los buffs/debuffs son reglas
-- del motor, no datos; aquí persiste la elección del jugador.
CREATE TABLE constitutions (
  country_id       UUID PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  government       TEXT NOT NULL CHECK (government IN ('autocracy','democracy')),
  economy          TEXT NOT NULL CHECK (economy IN ('planned','free_market')),
  military         TEXT NOT NULL CHECK (military IN ('conscription','professional')),
  migration        TEXT NOT NULL CHECK (migration IN ('open_borders','closed_borders')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ciudadanos: usuarios reales viviendo en un país (GDD §5).
CREATE TABLE citizenships (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  country_id  UUID REFERENCES countries(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'worker'
              CHECK (role IN ('worker','entrepreneur','soldier','minister')),
  health      SMALLINT NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  happiness   SMALLINT NOT NULL DEFAULT 60  CHECK (happiness BETWEEN 0 AND 100),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country_id)
);

-- ══════════════════════════════════════════════════════════════════════════
-- MAPA HEXAGONAL
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE hexagons (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id   SMALLINT NOT NULL REFERENCES worlds(id),
  q          INT NOT NULL,                         -- axial (docs/04-...md)
  r          INT NOT NULL,
  biome      TEXT NOT NULL CHECK (biome IN ('plain','forest','mountain','desert','coast')),
  elevation  REAL NOT NULL DEFAULT 0,
  is_coast   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (world_id, q, r)
);
-- Consulta espacial crítica (pantalla → hex → vecinos) en O(1):
CREATE INDEX idx_hexagons_world ON hexagons (world_id, q, r);

-- Propiedad del territorio: qué país posee cada hexágono.
-- Solo los países de jugadores persisten aquí; el territorio de las naciones
-- NPC se deriva del generador procedural determinista (misma seed).
CREATE TABLE country_hexes (
  world_id   SMALLINT NOT NULL REFERENCES worlds(id),
  q          INT NOT NULL,
  r          INT NOT NULL,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  is_capital BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (world_id, q, r)
);
-- ¿Qué territorio posee un país? (reconstrucción tras crash):
CREATE INDEX idx_country_hexes_country ON country_hexes (country_id);

-- ══════════════════════════════════════════════════════════════════════════
-- ECONOMÍA: MONEDAS Y RESERVAS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE currencies (
  code        TEXT PRIMARY KEY,                    -- 'CG' + monedas locales
  name        TEXT NOT NULL,
  country_id  UUID UNIQUE REFERENCES countries(id) ON DELETE CASCADE, -- NULL = CG global
  is_global   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id      SMALLINT NOT NULL REFERENCES worlds(id),
  country_id    UUID REFERENCES countries(id),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  amount        NUMERIC(20,4) NOT NULL,            -- negativo = retirada
  reason        TEXT NOT NULL,                     -- 'trade','salary','tax','war','heist'…
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_country_time ON ledger_entries (country_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- EDIFICIOS E INVENTARIOS (producción Tier 1→3, GDD §4.2)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE buildings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hex_id     BIGINT NOT NULL REFERENCES hexagons(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  tier       SMALLINT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
  level      SMALLINT NOT NULL DEFAULT 1,
  damaged_at TIMESTAMPTZ,                          -- artillería/sabotaje
  UNIQUE (hex_id, type)
);

CREATE TABLE inventories (
  country_id   UUID REFERENCES countries(id) ON DELETE CASCADE,
  resource     TEXT NOT NULL CHECK (resource IN ('cg','food','iron','coal','stone','oil','steel','fuel','arms','goods')),
  quantity     NUMERIC(20,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, resource)
);

-- ══════════════════════════════════════════════════════════════════════════
-- DIPLOMACIA Y CONFLICTO
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE treaties (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_a  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  country_b  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('non_aggression','free_trade','mutual_defense','puppet','peace')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (country_a <> country_b)
);

CREATE TABLE wars (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggressor  UUID NOT NULL REFERENCES countries(id),
  defender   UUID NOT NULL REFERENCES countries(id),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);

CREATE TABLE armies (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  unit_type   TEXT NOT NULL CHECK (unit_type IN ('infantry','tank','artillery')),
  soldiers    INT NOT NULL DEFAULT 0,
  hex_id      BIGINT REFERENCES hexagons(id),       -- posición actual
  supply_line BOOLEAN NOT NULL DEFAULT TRUE,        -- línea a capital (GDD §6.1)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_armies_position ON armies (hex_id);

CREATE TABLE espionage_missions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spy        UUID REFERENCES users(id) ON DELETE SET NULL,
  target     UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('recon','sabotage','heist','proxy_war')),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- ASAMBLEA GLOBAL ("ONU") Y GOBIERNO
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE assembly_proposals (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id    SMALLINT NOT NULL REFERENCES worlds(id),
  title       TEXT NOT NULL,
  effect      TEXT NOT NULL,                        -- 'embargo:cg','tax:5%'…
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','passed','rejected')),
  closes_at   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Voto ponderado por PIB/población (GDD §6.3); el peso lo calcula el motor.
CREATE TABLE assembly_votes (
  proposal_id BIGINT NOT NULL REFERENCES assembly_proposals(id) ON DELETE CASCADE,
  country_id  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  vote        TEXT NOT NULL CHECK (vote IN ('yes','no','abstain')),
  weight      NUMERIC(20,2) NOT NULL DEFAULT 1,
  cast_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, country_id)
);

CREATE TABLE ministries (
  country_id  UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio   TEXT NOT NULL CHECK (portfolio IN ('economy','defense','foreign')),
  appointed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, portfolio)
);

CREATE TABLE governments (
  country_id  UUID PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  leader_user UUID REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'autocracy' CHECK (kind IN ('autocracy','democracy','puppet_regime')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- TRIGGERS updated_at
-- ══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_constitutions_updated BEFORE UPDATE ON constitutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inventories_updated BEFORE UPDATE ON inventories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_governments_updated BEFORE UPDATE ON governments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
