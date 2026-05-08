-- Migration 093: sucursal_id en ordenes_compra
-- Permite filtrar OCs por sucursal en GastosPage (tab OC)

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_sucursal
  ON ordenes_compra(tenant_id, sucursal_id);
