-- 275: traslado_items gana las columnas de atributos de variante (talle/color/encaje/
-- formato/sabor_aroma) — sin esto, trasladar stock de un producto con el atributo activo
-- entre sucursales lo perdía en el camino: `traslado_items` no tenía dónde guardarlo, y la
-- línea de `inventario_lineas` creada en destino (recepción) o en origen (cancelación/
-- reingreso) quedaba con el atributo en null pese al producto tenerlo activado.
-- REGLA #0 — hallazgo de GO en la ronda 2/3 de pruebas de "Atributos de variante".

ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS talle text;
ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS encaje text;
ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS formato text;
ALTER TABLE traslado_items ADD COLUMN IF NOT EXISTS sabor_aroma text;

COMMENT ON COLUMN traslado_items.talle IS 'Snapshot del atributo de la línea origen al despachar el traslado — se propaga a la línea nueva en destino (recepción) o en origen (cancelación). No se re-pregunta: es la misma mercadería física.';
