-- Migration 279 (backlog Config Ventas/Envíos, punto 2 — pedido Fede/GO 2026-07-19):
-- Vigencia por FECHA en combos. Hasta hoy un combo solo se prendía/apagaba a mano (`activo`);
-- una promo tipo "3x2 solo la semana del Día del Niño" obligaba a acordarse de apagarla.
-- Aditiva, nullable: NULL = sin límite (comportamiento actual intacto).
-- El filtro de vigencia se aplica CLIENT-SIDE en el POS (helper puro `comboVigente`,
-- src/lib/descuentos — testeable en vitest y sin problemas de timezone del server).

ALTER TABLE public.combos
  ADD COLUMN IF NOT EXISTS vigencia_desde date,
  ADD COLUMN IF NOT EXISTS vigencia_hasta date;

COMMENT ON COLUMN public.combos.vigencia_desde IS
  'Primer día (inclusive) en que el combo aplica en el POS. NULL = desde siempre. Ver mig 279.';
COMMENT ON COLUMN public.combos.vigencia_hasta IS
  'Último día (inclusive) en que el combo aplica en el POS. NULL = sin vencimiento. Ver mig 279.';
