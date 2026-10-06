-- 476 — La prueba gratis pasa de 15 a 30 días (decisión de GO 2026-10-06, Landing 2.0: los docs de Fede la anuncian a 30).
--
-- Solo para las altas NUEVAS (mismo criterio que la mig 457 al pasarla a 15): las pruebas en curso conservan su fecha
-- (la landing no puede prometer 30 si la app da 15 — por eso cambia la base y los textos juntos, en el mismo release).
ALTER TABLE public.tenants ALTER COLUMN trial_ends_at SET DEFAULT (now() + '30 days'::interval);
