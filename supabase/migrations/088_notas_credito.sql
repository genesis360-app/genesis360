-- Migration 088: Campos de Nota de Crédito electrónica en devoluciones
-- Permite emitir NC-A/B/C vinculadas a una venta facturada con CAE

ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS nc_cae               TEXT,
  ADD COLUMN IF NOT EXISTS nc_vencimiento_cae   TEXT,
  ADD COLUMN IF NOT EXISTS nc_numero_comprobante INT,
  ADD COLUMN IF NOT EXISTS nc_tipo              TEXT CHECK (nc_tipo IN ('NC-A','NC-B','NC-C')),
  ADD COLUMN IF NOT EXISTS nc_punto_venta       INT;

-- Índice para buscar NC por CAE (trazabilidad)
CREATE INDEX IF NOT EXISTS idx_devoluciones_nc_cae ON devoluciones(nc_cae) WHERE nc_cae IS NOT NULL;
