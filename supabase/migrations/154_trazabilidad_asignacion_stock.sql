-- Migration 154: ISS-075 — Log de asignación de inventario (origen) + toggle por tenant
--
-- Completa la trazabilidad de despacho: además de QUÉ LPN/ubicación surtió cada unidad
-- (venta_item_despachos), registra POR QUÉ se eligió esa línea:
--   origen = 'manual' → el operador seleccionó ese LPN en el carrito (o la serie)
--   origen = 'auto'   → lo asignó el sistema por la regla de rebaje (FIFO/FEFO/prioridad)
--
-- El toggle tenants.trazabilidad_asignacion permite activar/desactivar el registro del
-- desglose de despacho desde Config → Inventario (default ON).

ALTER TABLE venta_item_despachos
  ADD COLUMN IF NOT EXISTS origen TEXT;   -- 'manual' | 'auto' | NULL (legacy)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trazabilidad_asignacion BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN venta_item_despachos.origen IS
  'ISS-075: cómo se eligió la línea — manual (selección del operador) o auto (regla de rebaje del sistema).';
COMMENT ON COLUMN tenants.trazabilidad_asignacion IS
  'ISS-075: si TRUE, se registra el desglose de despacho por LPN (venta_item_despachos) en cada venta. Configurable en Config → Inventario.';
