-- 277: venta_item_despachos gana las columnas de atributos de variante (talle/color/encaje/
-- formato/sabor_aroma) — sin esto, el desglose de despacho por LPN de una venta no snapshoteaba
-- QUÉ variante se consumió: el dato solo era visible en el carrito antes de confirmar la venta,
-- no en el historial post-venta (ISS-075). Snapshot puro, igual que lpn/ubicacion_nombre — si
-- después se edita/elimina la línea de origen, la traza queda intacta.
-- Diferido documentado en wiki/features/atributos-variante.md tras la ronda 3 (2026-07-18).

ALTER TABLE venta_item_despachos ADD COLUMN IF NOT EXISTS talle text;
ALTER TABLE venta_item_despachos ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE venta_item_despachos ADD COLUMN IF NOT EXISTS encaje text;
ALTER TABLE venta_item_despachos ADD COLUMN IF NOT EXISTS formato text;
ALTER TABLE venta_item_despachos ADD COLUMN IF NOT EXISTS sabor_aroma text;

COMMENT ON COLUMN venta_item_despachos.talle IS 'Snapshot del atributo de la línea de inventario consumida al momento del despacho — no se actualiza retroactivamente si la línea cambia.';
