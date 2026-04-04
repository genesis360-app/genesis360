-- Migration 033: columna notas en inventario_lineas
--
-- Permite agregar contexto a cada línea de inventario
-- (ej: "Devolución de venta #123", "Ingreso manual", etc.)

ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS notas TEXT;

COMMENT ON COLUMN inventario_lineas.notas IS 'Observaciones opcionales sobre el origen o contexto de la línea';
