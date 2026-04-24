-- Migration 063: es_disponible_tn en estados_inventario
-- Permite configurar por estado si el stock cuenta como disponible
-- para sincronizar con TiendaNube (y futuros canales externos).

ALTER TABLE estados_inventario
  ADD COLUMN IF NOT EXISTS es_disponible_tn BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN estados_inventario.es_disponible_tn IS
  'Si true, el stock en este estado se considera disponible para sincronizar a TiendaNube';
