-- ============================================================
-- 010: Prioridad de rebaje/reserva en ubicaciones
-- La prioridad vive en la UBICACIÓN, no en el LPN.
-- El operario piensa en "primero vaciar esta posición, luego aquella".
-- Todos los LPNs de una ubicación heredan su prioridad automáticamente.
-- Menor valor = mayor prioridad (0 se rebaja primero).
-- Excepción: si el producto tiene fecha_vencimiento activo,
-- la regla FEFO (menor fecha primero) tiene precedencia sobre la prioridad.
-- ============================================================

-- Quitar prioridad de inventario_lineas (approach anterior)
DROP INDEX IF EXISTS idx_lineas_prioridad;
ALTER TABLE inventario_lineas DROP COLUMN IF EXISTS prioridad;

-- Agregar prioridad a ubicaciones
ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS prioridad INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ubicaciones_prioridad
  ON ubicaciones(tenant_id, prioridad);
