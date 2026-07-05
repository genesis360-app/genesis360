-- 257: Trial de 30 días (antes 7) — decisión GO 2026-07-04.
-- El Landing/Onboarding/emails ahora prometen "30 días gratis"; el default de la DB
-- tiene que cumplirlo (si no, el texto sería un claim falso). Solo afecta a tenants
-- NUEVOS: los trials existentes conservan su trial_ends_at ya asignado.
ALTER TABLE tenants ALTER COLUMN trial_ends_at SET DEFAULT (NOW() + INTERVAL '30 days');
