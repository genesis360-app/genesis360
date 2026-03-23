-- ============================================================
-- 011: Reglas de selección de inventario (FIFO, FEFO, LEFO, LIFO, Manual)
-- Dos niveles de configuración:
--   1. tenant.regla_inventario  → regla default del negocio
--   2. productos.regla_inventario → override por SKU (NULL = usar la del negocio)
-- Jerarquía: SKU > Negocio > FIFO (fallback hardcoded)
-- FEFO/LEFO ignoran prioridad de ubicación y ordenan por fecha_vencimiento.
-- Si el producto no tiene tiene_vencimiento, FEFO/LEFO hacen fallback a FIFO.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS regla_inventario TEXT NOT NULL DEFAULT 'FIFO';

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS regla_inventario TEXT;
