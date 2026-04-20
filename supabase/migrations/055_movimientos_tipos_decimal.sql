-- ─── Migration 055: Fix movimientos_stock tipos + DECIMAL cantidad ──────────────

-- 1. Add ajuste_ingreso, ajuste_rebaje to tipo CHECK
--    (code already uses these types but they weren't in the constraint → silent failures)
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
  CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting', 'des_kitting', 'ajuste_ingreso', 'ajuste_rebaje', 'traslado'));

-- 2. cantidad INT → DECIMAL(14,4) to support decimal UOM (kg, l, g, etc.)
ALTER TABLE movimientos_stock
  ALTER COLUMN cantidad TYPE DECIMAL(14,4) USING cantidad::DECIMAL(14,4);
