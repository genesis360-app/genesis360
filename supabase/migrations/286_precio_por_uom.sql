-- ============================================================
-- 286_precio_por_uom.sql
-- Precio de venta/costo por Unidad de Medida en la estructura del producto
-- (backlog Fede, puntos 4/6/7 — relevamiento GO 2026-07-21, diseño cerrado).
--
-- Modelo:
--  · producto_estructura_niveles gana precio_venta/precio_costo OPCIONALES por nivel.
--    NULL = hereda por factor × precio del nivel ANTERIOR con precio cargado (nunca del
--    nivel base directo si hay niveles intermedios con precio propio — ver estructuras.ts).
--  · productos.nivel_precio_orden: qué nivel (por ORDEN, no por id) de la estructura DEFAULT
--    es el que "tiene" el precio de cabecera (productos.precio_venta/precio_costo). NULL =
--    nivel base (orden 1), el comportamiento de siempre.
--    🛑 Por qué ORDEN y no un FK a producto_estructura_niveles.id: la RPC
--    fn_estructura_guardar_niveles (mig 282) borra y reinserta TODOS los niveles en cada
--    guardado (los ids cambian siempre) — un FK a id se invalidaría en cada resave trivial,
--    aunque el usuario no haya tocado el nivel anclado. El ORDEN es estable mientras no se
--    achique la estructura por debajo de esa posición; si eso pasa, la app debe avisar antes
--    de confirmar Y el nivel_precio_orden queda simplemente sin match (se interpreta como
--    inválido → vuelve al nivel base), sin romper nada a nivel DB.
--  · venta_items gana unidad_medida_id + cantidad_uom — PURAMENTE trazabilidad/display (qué
--    UoM y cantidad-en-esa-UoM se vendió). `cantidad` SIGUE siendo unidades base: el rebaje de
--    stock y los reportes de margen no cambian.
--  · combos gana unidad_medida_id opcional — NULL = el combo solo aplica a ventas en la UoM
--    base del producto (preserva el comportamiento de TODOS los combos ya cargados). Con un
--    valor, el combo es específico de esa UoM — evita que el agrupador de combos mezcle mal
--    líneas de UoM distinta del mismo producto (bug real encontrado en el relevamiento).
-- ============================================================

ALTER TABLE producto_estructura_niveles
  ADD COLUMN IF NOT EXISTS precio_venta numeric(12,2) CHECK (precio_venta IS NULL OR precio_venta >= 0),
  ADD COLUMN IF NOT EXISTS precio_costo numeric(12,2) CHECK (precio_costo IS NULL OR precio_costo >= 0);

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS nivel_precio_orden integer CHECK (nivel_precio_orden IS NULL OR nivel_precio_orden >= 1);

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS unidad_medida_id uuid REFERENCES unidades_medida(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cantidad_uom numeric(12,3) CHECK (cantidad_uom IS NULL OR cantidad_uom > 0);

ALTER TABLE combos
  ADD COLUMN IF NOT EXISTS unidad_medida_id uuid REFERENCES unidades_medida(id) ON DELETE SET NULL;

COMMENT ON COLUMN producto_estructura_niveles.precio_venta IS
  'Precio de venta propio de este nivel (NULL = hereda por factor × precio del nivel anterior con precio cargado). Ver mig 286.';
COMMENT ON COLUMN producto_estructura_niveles.precio_costo IS
  'Costo propio de este nivel (NULL = hereda por factor × costo del nivel anterior con costo cargado). Ver mig 286.';
COMMENT ON COLUMN productos.nivel_precio_orden IS
  'Orden (producto_estructura_niveles.orden) del nivel de la estructura DEFAULT que "tiene" el precio de cabecera (precio_venta/precio_costo). NULL = nivel base (orden 1). Por ORDEN, no por id (la RPC de guardado reinserta los niveles en cada save) — ver comentario del archivo de migración.';
COMMENT ON COLUMN venta_items.unidad_medida_id IS
  'UoM en la que se vendió esta línea (ej. Caja) — trazabilidad/display. cantidad sigue en unidades base, el rebaje de stock no cambia.';
COMMENT ON COLUMN venta_items.cantidad_uom IS
  'Cantidad vendida EN unidad_medida_id (ej. 3 si se vendieron 3 Cajas = 36 unidades base en cantidad).';
COMMENT ON COLUMN combos.unidad_medida_id IS
  'UoM a la que aplica este combo (NULL = solo unidad base del producto). Evita que el agrupador de combos mezcle líneas de UoM distinta del mismo producto.';
