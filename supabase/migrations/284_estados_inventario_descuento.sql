-- ============================================================
-- 284_estados_inventario_descuento.sql
-- Descuento automático por estado de inventario (backlog Fede, punto 3).
-- Un estado (ej. "Próximo a Vencer") puede tener un % de descuento propio;
-- una venta cuyo stock consumido esté en ese estado aplica el % automático.
-- No requiere clave de supervisor (el estado ya lo configuró a propósito un
-- DUEÑO/ADMIN de antemano) y se apila con otros descuentos, mismo criterio
-- que el descuento por método de pago (mig 281, ventas.promo_pago).
-- ============================================================

ALTER TABLE estados_inventario
  ADD COLUMN IF NOT EXISTS descuento_pct numeric(5,2)
  CHECK (descuento_pct IS NULL OR (descuento_pct > 0 AND descuento_pct <= 100));

COMMENT ON COLUMN estados_inventario.descuento_pct IS
  '% de descuento automático al vender stock en este estado (NULL/0 = sin descuento). Se aplica sin clave de supervisor y se apila con otros descuentos de la venta.';
