-- ============================================================================
-- DCE Global Country — Esquema PostgreSQL (v1.0-alpha)
--
-- Cómo aplicarlo:
--   createdb dce_global_country
--   psql dce_global_country -f sql/schema.sql -f sql/seed.sql
--
-- El motor de simulación (packages/simulation) persiste por snapshot completo
-- tras cada acción: las tablas reflejan exactamente el PersistedState del
-- motor (docs/01 §2). El terreno NPC se deriva del generador procedural.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- USUARIOS Y MUNDO
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      CITEXT UNIQUE NOT NULL,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                    -- scrypt
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE worlds (
  id          SMALLINT PRIMARY KEY,
  name        TEXT NOT NULL,
  seed        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- PAÍSES (incluye estado vivo: felicidad, rebelión, economía, wiki)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE countries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id          SMALLINT NOT NULL REFERENCES worlds(id),
  name              TEXT NOT NULL,
  color             TEXT NOT NULL DEFAULT '#3b82f6',
  flag_svg          TEXT NOT NULL DEFAULT '',
  population        INTEGER NOT NULL DEFAULT 100,
  cap_q             INT,
  cap_r             INT,
  founded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  founded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_pariah         BOOLEAN NOT NULL DEFAULT FALSE,     -- retirado de la ONU (GDD §6.3)
  is_puppet_of      UUID REFERENCES countries(id),      -- estado títere (GDD §6.1)
  salary            INTEGER NOT NULL DEFAULT 5,         -- CG por obrero y Tick
  happiness         SMALLINT NOT NULL DEFAULT 60,
  rebellion_strength NUMERIC(8,2) NOT NULL DEFAULT 0,   -- GDD §5
  currency_code     TEXT NOT NULL DEFAULT 'XXX',
  gdp               NUMERIC(20,2) NOT NULL DEFAULT 0,
  wiki_history      TEXT NOT NULL DEFAULT '',           -- Wiki Nacional (GDD §3.1)
  wiki_motto        TEXT NOT NULL DEFAULT '',
  UNIQUE (world_id, name)
);

CREATE TABLE constitutions (
  country_id  UUID PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  government  TEXT NOT NULL CHECK (government IN ('autocracy','democracy')),
  economy     TEXT NOT NULL CHECK (economy IN ('planned','free_market')),
  military    TEXT NOT NULL CHECK (military IN ('conscription','professional')),
  migration   TEXT NOT NULL CHECK (migration IN ('open_borders','closed_borders')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE citizenships (
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username             TEXT NOT NULL,
  country_id           UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL DEFAULT 'worker'
                       CHECK (role IN ('worker','soldier','minister')),
  assigned_building_id UUID,
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);
CREATE INDEX idx_citizenships_country ON citizenships (country_id);

-- ══════════════════════════════════════════════════════════════════════════
-- MAPA: TERRENO (estático, derivable) Y PROPIEDAD (volátil)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE hexagons (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id   SMALLINT NOT NULL REFERENCES worlds(id),
  q          INT NOT NULL,
  r          INT NOT NULL,
  biome      TEXT NOT NULL CHECK (biome IN ('plain','forest','mountain','desert','coast')),
  elevation  REAL NOT NULL DEFAULT 0,
  is_coast   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (world_id, q, r)
);
CREATE INDEX idx_hexagons_world ON hexagons (world_id, q, r);

CREATE TABLE country_hexes (
  world_id   SMALLINT NOT NULL REFERENCES worlds(id),
  q          INT NOT NULL,
  r          INT NOT NULL,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  is_capital BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (world_id, q, r)
);
CREATE INDEX idx_country_hexes_country ON country_hexes (country_id);

-- ══════════════════════════════════════════════════════════════════════════
-- ECONOMÍA (GDD §4)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE currencies (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  country_id  UUID UNIQUE REFERENCES countries(id) ON DELETE CASCADE,
  is_global   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventories (
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  resource   TEXT NOT NULL CHECK (resource IN ('cg','food','iron','coal','stone','oil','steel','fuel','arms','goods')),
  quantity   NUMERIC(20,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country_id, resource)
);

CREATE TABLE buildings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  q          INT NOT NULL,
  r          INT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('farm','mine','well','foundry','refinery','arms_factory','consumer_industry')),
  tier       SMALLINT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
  level      SMALLINT NOT NULL DEFAULT 1,
  workers    SMALLINT NOT NULL DEFAULT 0,
  damaged_at TIMESTAMPTZ
);
CREATE INDEX idx_buildings_country ON buildings (country_id);

CREATE TABLE ledger_entries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id      SMALLINT NOT NULL REFERENCES worlds(id),
  country_id    UUID REFERENCES countries(id) ON DELETE SET NULL,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  amount        NUMERIC(20,4) NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_country_time ON ledger_entries (country_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- DIPLOMACIA, GUERRA Y ESPIONAJE (GDD §6)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE treaties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  a          UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  b          UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('non_aggression','free_trade','mutual_defense')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (a <> b)
);

CREATE TABLE wars (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggressor_id   UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  defender_id    UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  captured_hexes JSONB NOT NULL DEFAULT '[]'::jsonb,
  winner_id      UUID REFERENCES countries(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ
);
CREATE INDEX idx_wars_active ON wars (status) WHERE status = 'active';

CREATE TABLE armies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id      UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  unit_type       TEXT NOT NULL CHECK (unit_type IN ('infantry','tank','artillery')),
  soldiers        INTEGER NOT NULL DEFAULT 0,
  q               INT NOT NULL,
  r               INT NOT NULL,
  supply          BOOLEAN NOT NULL DEFAULT TRUE,      -- línea a capital (GDD §6.1)
  last_moved_tick INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_armies_country ON armies (country_id);

CREATE TABLE espionage_missions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spy_country_id   UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  target_country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('recon','sabotage','heist','proxy')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  result           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════
-- ASAMBLEA GLOBAL ("ONU", GDD §6.3) — voto ponderado por PIB/población
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE assembly_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id       UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('embargo','tax')),
  target_country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  tax_percent       SMALLINT NOT NULL DEFAULT 0,
  votes             JSONB NOT NULL DEFAULT '{}'::jsonb, -- {countryId: yes|no|abstain}
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','passed','rejected')),
  closes_at         BIGINT NOT NULL,                    -- epoch ms
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
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
-- TRIGGERS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_constitutions_updated BEFORE UPDATE ON constitutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_inventories_updated BEFORE UPDATE ON inventories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_governments_updated BEFORE UPDATE ON governments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
