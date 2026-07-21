-- ============================================================
-- 285_venta_descuento_estado.sql
-- Trazabilidad del descuento automático por estado de inventario (backlog Fede, punto 3,
-- ver mig 284). REGLA #0: todo descuento que reduce el total cobrado tiene que quedar
-- registrado en el documento de la venta, no solo implícito en el total (mismo criterio que
-- ventas.promo_pago, mig 281).
-- ============================================================

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS descuento_estado_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS descuento_estado_monto numeric(12,2);

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS descuento_estado jsonb;

COMMENT ON COLUMN venta_items.descuento_estado_pct IS
  '% de descuento automático por estado aplicado en esta línea (NULL = no aplicó, o mezcla de más de un estado — ver descuento_estado_monto). Ver mig 284.';
COMMENT ON COLUMN venta_items.descuento_estado_monto IS
  'Monto $ descontado en esta línea por descuento automático de estado del stock consumido.';
COMMENT ON COLUMN ventas.descuento_estado IS
  'Detalle de descuentos automáticos por estado aplicados en la venta: [{estado_nombre, pct, cantidad, monto}]. El total de la venta ya los tiene restados. NULL = sin descuento por estado. Ver src/lib/descuentoEstado.ts.';
