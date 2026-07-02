-- Migration 250 — Dual-provider AFIP (AfipSDK + WSFE propio) con rollback por-tenant.
-- Fase 1 del plan dual-provider (ver project_pendientes.md → BACKLOG WSFE + wiki/features/facturacion-afip.md).
-- Aditiva/idempotente y SIN cambio de comportamiento: TODOS los tenants quedan en 'afipsdk'
-- (el circuito actual). El WSFE propio se activa por-tenant cambiando la flag, con rollback
-- instantáneo volviéndola a 'afipsdk'. Mismo patrón que `afip_produccion` (mig 210).
--
--   • tenants.afip_provider        → qué circuito usa la EF `emitir-factura` para ese tenant.
--   • ventas.afip_provider_usado   → trazabilidad: con qué provider se emitió el CAE de esa venta.
--   • devoluciones.afip_provider_usado → ídem para el CAE de la NC.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS afip_provider TEXT NOT NULL DEFAULT 'afipsdk'
    CHECK (afip_provider IN ('afipsdk','propio'));

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS afip_provider_usado TEXT;

ALTER TABLE public.devoluciones
  ADD COLUMN IF NOT EXISTS afip_provider_usado TEXT;

COMMENT ON COLUMN public.tenants.afip_provider IS 'Circuito de facturación AFIP del tenant: ''afipsdk'' (default, AfipSDK cloud) o ''propio'' (WSFE directo). Rollback = volver a ''afipsdk''. (mig 250)';
COMMENT ON COLUMN public.ventas.afip_provider_usado IS 'Provider con el que se emitió el CAE de esta venta (trazabilidad dual-provider). (mig 250)';
COMMENT ON COLUMN public.devoluciones.afip_provider_usado IS 'Provider con el que se emitió el CAE de la NC de esta devolución. (mig 250)';
