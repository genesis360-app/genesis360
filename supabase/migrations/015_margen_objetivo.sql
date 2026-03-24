-- ============================================================
-- 015 — margen_objetivo en productos
-- Permite configurar un % de margen objetivo por SKU
-- para generar insights automáticos en Métricas
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen_objetivo DECIMAL(5,2);

COMMENT ON COLUMN productos.margen_objetivo IS 'Porcentaje de margen de ganancia objetivo (0-100). Null = sin objetivo definido.';
