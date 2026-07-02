-- Migration 253 — Pricing 2026 · FASE 2: idempotencia del add-on temporal de movimientos.
-- El webhook de MP (mp-webhook) recibe VARIAS notificaciones por el mismo pago. El flujo
-- legacy incrementaba tenants.addon_movimientos sin idempotencia → una re-notificación
-- DUPLICABA los movimientos acreditados (REGLA #0: no acreditar de más).
--
-- Al mover el add-on al ledger tenant_addons (mig 251), garantizamos "una fila por pago MP"
-- con un índice único parcial sobre mp_payment_id. El webhook inserta con ON CONFLICT /
-- captura el 23505 → reintentos idempotentes.
--
-- Aditiva/idempotente. No toca add-ons existentes (mp_payment_id NULL quedan fuera del índice).

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_addons_mp_payment
  ON public.tenant_addons (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

COMMENT ON INDEX public.uq_tenant_addons_mp_payment IS
  'Idempotencia del webhook MP: 1 add-on por pago (evita doble acreditación en reintentos). Mig 253.';
