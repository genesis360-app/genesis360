-- ============================================================
-- Migration 184 — Compras · CO3 (Costos)
--   E1 alerta de cambio de costo · E2 costos accesorios sueltos · E3 alta de
--   producto en recepción (pendiente de revisión). B6 (editar precio) usa audit log.
--   Aditiva e idempotente.
-- ============================================================

-- E1 — umbral % para alertar cambio de costo al recibir (operador decide actualizar).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS compras_costo_alerta_pct NUMERIC NOT NULL DEFAULT 10;

-- E2 — costos accesorios sueltos de la OC (no se distribuyen al costo unitario).
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS costo_aduana NUMERIC,
  ADD COLUMN IF NOT EXISTS costo_comision NUMERIC,
  ADD COLUMN IF NOT EXISTS costo_otros NUMERIC;

-- E3 — producto dado de alta durante la recepción queda marcado para revisión.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_productos_pendiente_revision
  ON productos(tenant_id) WHERE pendiente_revision = true;
