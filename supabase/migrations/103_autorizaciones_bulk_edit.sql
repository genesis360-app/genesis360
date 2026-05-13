-- Migration 103: bulk_edit en autorizaciones_inventario
-- Agrega el tipo 'bulk_edit' para cambios masivos de atributos de LPNs
-- y permite linea_id nulo (el bulk_edit guarda los IDs en datos_cambio)

-- 1. Relajar linea_id para que sea nullable (bulk_edit no tiene una sola linea)
ALTER TABLE autorizaciones_inventario
  ALTER COLUMN linea_id DROP NOT NULL;

-- 2. Ampliar CHECK constraint de tipo
ALTER TABLE autorizaciones_inventario
  DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;

ALTER TABLE autorizaciones_inventario
  ADD CONSTRAINT autorizaciones_inventario_tipo_check
  CHECK (tipo IN ('ajuste_cantidad', 'eliminar_serie', 'eliminar_lpn', 'bulk_edit'));
