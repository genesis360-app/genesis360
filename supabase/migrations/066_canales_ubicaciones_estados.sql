-- Migration 066: disponibilidad por canal en ubicaciones y estados

-- Ubicaciones: marcar si el stock de esta ubicación aplica a TN / MELI
ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS disponible_tn   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS disponible_meli BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ubicaciones.disponible_tn   IS 'Si false, el stock de esta ubicación no se sincroniza con TiendaNube';
COMMENT ON COLUMN ubicaciones.disponible_meli IS 'Si false, el stock de esta ubicación no se sincroniza con MercadoLibre';

-- Estados: marcar si el estado es vendible para MELI
ALTER TABLE estados_inventario
  ADD COLUMN IF NOT EXISTS es_disponible_meli BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN estados_inventario.es_disponible_meli IS 'Si false, el stock en este estado no se sincroniza con MercadoLibre';
