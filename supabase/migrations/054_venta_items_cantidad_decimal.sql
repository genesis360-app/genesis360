-- Migration 054: venta_items.cantidad INT → DECIMAL(14,4)
-- Necesario para soportar productos con unidades de medida decimales (kg, g, l, etc.)
-- El CHECK (cantidad > 0) se elimina y recrea para DECIMAL

ALTER TABLE venta_items
  ALTER COLUMN cantidad TYPE DECIMAL(14,4) USING cantidad::DECIMAL(14,4);

-- Recrea el check para DECIMAL (acepta fraccionarios positivos)
ALTER TABLE venta_items
  DROP CONSTRAINT IF EXISTS venta_items_cantidad_check;

ALTER TABLE venta_items
  ADD CONSTRAINT venta_items_cantidad_check CHECK (cantidad > 0);
