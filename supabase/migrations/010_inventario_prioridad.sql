-- ============================================================
-- 010: Prioridad de posiciones en inventario_lineas
-- Permite definir el orden de rebaje/reserva cuando hay
-- múltiples LPNs con el mismo SKU+lote+vencimiento.
-- Menor valor = mayor prioridad (0 se rebaja primero).
-- Excepción: si el producto tiene fecha_vencimiento activo,
-- la regla FEFO (menor fecha primero) tiene precedencia.
-- ============================================================

ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS prioridad INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lineas_prioridad
  ON inventario_lineas(tenant_id, producto_id, prioridad);
