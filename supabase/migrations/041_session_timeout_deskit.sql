-- Migration 041: session_timeout_minutes + des_kitting + kitting_log.tipo

-- 1. Tiempo de inactividad configurable por tenant (NULL = nunca expira)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS session_timeout_minutes INT DEFAULT NULL;

-- 2. Nuevo tipo de movimiento para desarmar KITs
DO $$
BEGIN
  ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
  ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
    CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting', 'des_kitting'));
END $$;

-- 3. Tipo de operación en kitting_log (armado vs desarmado)
ALTER TABLE kitting_log
  ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'armado' CHECK (tipo IN ('armado', 'desarmado'));
