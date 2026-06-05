-- ============================================================
-- Migration 180 — Conteos 2.0 · Fase F4
--   Clase ABC (auto + override), última fecha de conteo, trazabilidad por
--   operador (quién contó) y config de cíclico (días por clase).
--   Aditiva e idempotente. Sin DDL destructivo.
-- ============================================================

-- 1. Clase ABC del producto para el ciclo de conteo (F2 del relevamiento).
--    Auto-calculable desde el valor de movimiento (Pareto 80/95) + override manual.
--    clase_abc_manual = true → el recálculo automático NO la pisa.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS clase_abc TEXT,
  ADD COLUMN IF NOT EXISTS clase_abc_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ultimo_conteo_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'productos_clase_abc_check' AND table_name = 'productos') THEN
    ALTER TABLE productos ADD CONSTRAINT productos_clase_abc_check
      CHECK (clase_abc IS NULL OR clase_abc IN ('A', 'B', 'C'));
  END IF;
END $$;

-- 2. Trazabilidad por operador (H3): quién contó cada ítem.
--    (reconteo_por se sumará en F3b — doble conteo formal por 2º operador.)
ALTER TABLE inventario_conteo_items
  ADD COLUMN IF NOT EXISTS contado_por UUID REFERENCES users(id);

-- 3. Config del conteo cíclico sugerido (F1=D: nada automático, solo sugerencia).
--    Cada cuántos días conviene recontar según la clase ABC. Editable por el dueño.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_a INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_b INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_c INTEGER NOT NULL DEFAULT 180;

-- Índice para la sugerencia cíclica (productos por clase + última fecha de conteo).
CREATE INDEX IF NOT EXISTS idx_productos_clase_abc ON productos(tenant_id, clase_abc, ultimo_conteo_at);
