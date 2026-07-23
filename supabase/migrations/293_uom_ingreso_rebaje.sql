-- ============================================================
-- 293_uom_ingreso_rebaje.sql
-- Fase 2 del roadmap Estructuras-UdM (acordado con GO 2026-07-19, pendiente hasta hoy):
-- "Operar por UdM al ingresar stock (recibir '5 cajas' → 60 unidades; UdM trazada en el
-- LPN; stock SIEMPRE en unidad base)". GO pidió hoy (2026-07-22) extenderlo también a
-- rebajes (simple y masivo), no solo ingreso.
--
-- `convertirABase()` en src/lib/estructuras.ts ya existía "lista para Fase 2" (comentario
-- de la mig 282/283) — esta migración solo agrega dónde TRAZAR qué UdM se usó, el cálculo
-- en sí no es nuevo.
--
-- inventario_lineas: UdM en la que se RECIBIÓ ese LPN puntual (permanente, se fija al
-- ingresar, igual criterio que venta_items.unidad_medida_id/cantidad_uom de la mig 286).
-- movimientos_stock: UdM de la OPERACIÓN (ingreso o rebaje) — necesario porque un rebaje
-- puede consumir de varios LPNs con distinta UdM de origen; acá se traza en qué UdM lo tecleó
-- el usuario para ESA operación puntual, no depende de una sola línea.
--
-- Ambas nullable — NULL cuando el producto no tiene estructura con más de 1 nivel (sigue
-- operando en unidad base como siempre, sin cambio de comportamiento). Aditiva, sin DDL
-- destructivo.
-- ============================================================

ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS unidad_medida_id uuid REFERENCES unidades_medida(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cantidad_uom numeric(12,3) CHECK (cantidad_uom IS NULL OR cantidad_uom > 0);

COMMENT ON COLUMN inventario_lineas.unidad_medida_id IS
  'UdM en la que se recibió este LPN (ej. "Caja") — NULL si se ingresó directo en unidad base o el producto no tiene estructura multi-nivel. cantidad sigue SIEMPRE en unidades base.';
COMMENT ON COLUMN inventario_lineas.cantidad_uom IS
  'Cantidad tal como la tecleó el usuario en unidad_medida_id (ej. 5 = "5 cajas"). cantidad = cantidad_uom × unidades_base del nivel elegido.';

ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS unidad_medida_id uuid REFERENCES unidades_medida(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cantidad_uom numeric(12,3) CHECK (cantidad_uom IS NULL OR cantidad_uom > 0);

COMMENT ON COLUMN movimientos_stock.unidad_medida_id IS
  'UdM en la que se tecleó esta operación de ingreso/rebaje (ej. "Caja") — NULL si fue en unidad base o el producto no tiene estructura multi-nivel. cantidad sigue SIEMPRE en unidades base.';
COMMENT ON COLUMN movimientos_stock.cantidad_uom IS
  'Cantidad tal como la tecleó el usuario en unidad_medida_id para esta operación puntual.';
