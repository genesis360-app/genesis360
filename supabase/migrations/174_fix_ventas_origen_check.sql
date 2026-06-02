-- ============================================================
-- Migration 174 — Fix: quitar constraint rígida `ventas_origen_check`
-- Desde mig 168 (canales_venta, v1.15.0) el canal de venta (`ventas.origen`) es
-- CONFIGURABLE por tenant (catálogo `canales_venta`, texto libre). La constraint
-- original (mig 122) tenía una lista fija (POS/MELI/Instagram/…) y rechazaba
-- cualquier canal nuevo creado por el usuario → "new row violates check
-- constraint ventas_origen_check" al vender.
-- Una CHECK no puede referenciar otra tabla, así que se elimina; el canal se
-- valida a nivel de app contra el catálogo del tenant.
-- ============================================================

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_origen_check;
