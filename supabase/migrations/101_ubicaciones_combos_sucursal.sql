-- Migration 101: sucursal_id en ubicaciones y combos
-- Permite filtrar ubicaciones físicas y combos por sucursal

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL;

ALTER TABLE combos
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ubicaciones_sucursal ON ubicaciones(sucursal_id) WHERE sucursal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_combos_sucursal ON combos(sucursal_id) WHERE sucursal_id IS NOT NULL;

-- Los registros existentes quedan con sucursal_id = NULL (visibles en todas las sucursales)
-- Invariante: sucursal_id NULL = global (visible en todas), ID = solo esa sucursal
