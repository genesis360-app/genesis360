-- 445 — Alertas de reconciliación de Mercado Pago: el equipo puede DESCARTARLAS desde el panel interno
--
-- Hasta acá las alertas de `mp-reconciliacion` (mig 256) solo llegaban por mail y no había forma de decir "esto ya lo
-- vimos": al 2026-10-01 PROD tenía 2 "huérfanas" abiertas que eran suscripciones de prueba del equipo (confirmado por
-- GO). Ahora el panel las lista y permite descartarlas con una nota.
--
-- Semántica:
--  · `descartada_at` IS NOT NULL = el equipo la revisó y decidió no actuar (p. ej. prueba interna). Sigue "abierta"
--    para el sweep (resolved_at NULL) → no se re-emailea; si el preapproval desaparece, el sweep la resuelve igual.
--  · Si un hallazgo se resuelve y REAPARECE, el sweep lo reabre limpiando también el descarte (es un hecho nuevo).
--
-- Aditiva e idempotente. La tabla sigue sin acceso para anon/authenticated (solo service_role vía admin-api).

ALTER TABLE public.mp_billing_alertas
  ADD COLUMN IF NOT EXISTS descartada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS descartada_por uuid,
  ADD COLUMN IF NOT EXISTS nota           text;

COMMENT ON COLUMN public.mp_billing_alertas.descartada_at IS
  'El equipo la revisó y decidió no actuar (p. ej. prueba interna). No se re-emailea; el sweep la resuelve si desaparece.';
