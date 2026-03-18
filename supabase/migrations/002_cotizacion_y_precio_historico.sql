-- ─── M6: Cotización USD global por tenant ─────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cotizacion_usd       DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS cotizacion_usd_updated_at TIMESTAMPTZ;

-- ─── M7: Precio de costo histórico por línea de inventario ────────────────────
-- Captura el precio de compra en el momento del ingreso.
-- Cuando se modifica productos.precio_costo en el futuro, las líneas
-- ya ingresadas conservan el precio con el que fueron compradas.
ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS precio_costo_snapshot DECIMAL(14,2);
