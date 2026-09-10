-- ============================================================================
-- DCE Global Country — Datos de arranque (seed) para desarrollo local.
-- Aplicar DESPUÉS de schema.sql:
--   psql dce_global_country -f sql/seed.sql
-- ============================================================================

INSERT INTO worlds (id, name, seed) VALUES
  (1, 'Terra Alpha', 'dce-global-country-alpha');

INSERT INTO currencies (code, name, is_global) VALUES
  ('CG', 'Crédito Global', TRUE);

-- Moneda local de ejemplo: vale según PIB y reservas de CG (GDD §4.1).
INSERT INTO currencies (code, name) VALUES
  ('AUR', 'Aurora');

INSERT INTO countries (world_id, name, founded_by, is_pariah) VALUES
  (1, 'República de Aurora', NULL, FALSE)
RETURNING id;

-- (El país demo se crea con founded_by NULL: en el Alpha los países demo
--  del mapa procedimental aún no tienen usuario fundador.)
