-- Migration 126: descuento en ordenes de compra (ISS-132)
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS monto_descuento NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN ordenes_compra.monto_descuento IS 'Descuento otorgado por el proveedor al momento del pago';
