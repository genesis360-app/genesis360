-- ─── Migration 059: Agregar estados recibida_parcial y recibida a ordenes_compra ───
-- La recepción de mercadería actualiza el estado de la OC vinculada.

ALTER TABLE ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE ordenes_compra ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN ('borrador', 'enviada', 'confirmada', 'cancelada', 'recibida_parcial', 'recibida'));
