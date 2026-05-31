-- Migration 158: ISS-127 — GTIN dedicado en productos
--
-- El GTIN del código GS1 (AI 01) se matchea contra productos.gtin; si no hay
-- match, cae por fallback a codigo_barras (ambos normalizados sin ceros a la
-- izquierda en el frontend). Separar gtin de codigo_barras permite manejar
-- GTIN-14 de bultos sin pisar el EAN unitario que ya carga el usuario.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS gtin TEXT;

CREATE INDEX IF NOT EXISTS idx_productos_gtin ON productos(tenant_id, gtin);

COMMENT ON COLUMN productos.gtin IS
  'ISS-127: GTIN (GS1 AI 01) para match de códigos compuestos. Fallback a codigo_barras si NULL.';
