-- Migration 210: Flag por-tenant para emisión AFIP en PRODUCCIÓN real
--
-- Contexto: el módulo de facturación electrónica está en PROD pero emite contra
-- HOMOLOGACIÓN (sandbox de AFIP). La EF `emitir-factura` decidía homologación vs
-- producción con una env var GLOBAL del proyecto Supabase (`AFIP_PRODUCTION`), lo que
-- es peligroso: prenderla pasaría a TODOS los tenants con facturación habilitada a
-- emitir comprobantes FISCALES REALES e irreversibles de golpe.
--
-- Esta migración introduce un interruptor POR-TENANT (`tenants.afip_produccion`) para
-- pasar a producción real un cliente a la vez, de forma controlada. La EF lo lee como
-- fuente de verdad; la env var global pasa a ser SOLO un freno de emergencia
-- (`AFIP_FORCE_HOMOLOGACION=true` fuerza homologación para todos, nunca prende prod).
--
-- Default false → todos los tenants existentes quedan en HOMOLOGACIÓN (= comportamiento
-- actual, cero impacto). Aditiva e idempotente.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS afip_produccion BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.afip_produccion IS
  'Si true, la EF emitir-factura emite contra AFIP PRODUCCIÓN (CAE fiscal real). '
  'Si false (default), emite contra homologación (sandbox). Solo lo cambia el DUEÑO '
  'desde Config → Facturación tras completar el onboarding AFIP (CUIT activo + '
  'certificado + token AfipSDK de producción). Ver runbook en G360.Wiki.';
