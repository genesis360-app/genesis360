-- Migration 064: es_disponible_venta en estados_inventario
-- Controla si el stock en este estado puede ser vendido/reservado.
-- Estados con es_disponible_venta = false (ej: Bloqueado, Cuarentena)
-- no aparecen como stock vendible ni pueden ser reservados.

ALTER TABLE estados_inventario
  ADD COLUMN IF NOT EXISTS es_disponible_venta BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN estados_inventario.es_disponible_venta IS
  'Si false, el stock en este estado no puede ser vendido ni reservado';
