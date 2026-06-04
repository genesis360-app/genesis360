-- ============================================================
-- Migration 179 — Conteos 2.0 · Fase F3
--   Gate de autorización de ajustes de conteo (vía tab Autorizaciones existente),
--   umbrales de doble conteo, y config asociada. Aditiva e idempotente.
-- ============================================================

-- 1. Nuevo tipo 'ajuste_conteo' en autorizaciones_inventario (D1).
--    Las diferencias de conteo que superen el gate quedan pendientes de aprobación acá.
ALTER TABLE autorizaciones_inventario DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;
ALTER TABLE autorizaciones_inventario
  ADD CONSTRAINT autorizaciones_inventario_tipo_check
  CHECK (tipo IN ('ajuste_cantidad', 'eliminar_serie', 'eliminar_lpn', 'bulk_edit', 'ajuste_conteo'));

-- 2. Config del gate de ajustes (D1/D2) y del doble conteo (C1) por tenant.
--    Gate inactivo => TODO ajuste de conteo requiere autorización.
--    Gate activo => solo los que superen alguno de los umbrales (unidades / % / valor $).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_gate_activo          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS conteo_gate_umbral_u        NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_gate_umbral_pct      NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_gate_umbral_valor    NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_u    NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_pct  NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_valor NUMERIC;
