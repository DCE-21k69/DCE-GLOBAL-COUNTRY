-- ============================================================================
-- DCE Global Country — Datos de arranque (seed) para desarrollo local.
-- Aplicar DESPUÉS de schema.sql:
--   psql dce_global_country -f sql/seed.sql
--
-- Nota: las naciones NPC del mundo base NO se insertan aquí: se derivan del
-- generador procedural determinista (misma seed → mismo mundo). La base de
-- datos solo persiste a los países fundados por jugadores.
-- ============================================================================

INSERT INTO worlds (id, name, seed) VALUES
  (1, 'Terra Alpha', 'dce-global-country-alpha');

INSERT INTO currencies (code, name, is_global) VALUES
  ('CG', 'Crédito Global', TRUE);

-- Moneda local de ejemplo: su valor dependerá del PIB y las reservas de CG
-- del país que la emita (GDD §4.1).
INSERT INTO currencies (code, name) VALUES
  ('AUR', 'Aurora');
