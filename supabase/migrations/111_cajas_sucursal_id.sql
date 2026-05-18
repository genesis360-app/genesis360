-- Migration 111: sucursal_id en cajas
-- Cada caja operativa pertenece a una sucursal.
-- La Caja Fuerte (es_caja_fuerte=true) queda con sucursal_id NULL → compartida a nivel tenant.

ALTER TABLE cajas ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cajas_sucursal ON cajas(sucursal_id);
