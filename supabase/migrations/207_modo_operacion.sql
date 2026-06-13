-- Migration 207: Modo de operación por tenant — Básico vs Avanzado (WMS)
--
-- 'basico'  = experiencia simplificada (kiosco/almacén/pyme chica): nav reducido y
--             superficies WMS ocultas. Solo capa de PRESENTACIÓN: los datos siguen
--             siendo grado WMS por debajo (LPN auto, despachos, ledger).
-- 'avanzado'= sistema completo actual (gateado a plan Pro+ en el front).
-- Aditiva. Rollback total = UPDATE tenants SET modo_operacion='avanzado'
-- (o ALTER TABLE tenants DROP COLUMN modo_operacion; el front viejo ignora la columna).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modo_operacion TEXT NOT NULL DEFAULT 'basico'
  CHECK (modo_operacion IN ('basico', 'avanzado'));

-- Los tenants existentes conservan la experiencia actual (UI completa).
-- Solo los tenants creados después de esta migración arrancan en 'basico'.
UPDATE tenants SET modo_operacion = 'avanzado';
