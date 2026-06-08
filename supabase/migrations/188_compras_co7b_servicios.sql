-- ============================================================
-- Migration 188 — Compras · CO7b (Servicios)
--   F1 servicios recurrentes (frecuencia + próximo vencimiento) ·
--   F2 catálogo de servicios genéricos del tenant (proveedor_id nullable).
--   Aditiva e idempotente.
-- ============================================================

-- F1 — recurrencia: el servicio genera un gasto cada cierta frecuencia (sweep lazy en la app).
ALTER TABLE servicio_items
  ADD COLUMN IF NOT EXISTS recurrente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frecuencia TEXT,            -- mensual|bimestral|trimestral|semestral|anual
  ADD COLUMN IF NOT EXISTS proximo_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

-- F2 — servicios genéricos del tenant (sin proveedor). El catálogo admite ambos modos.
ALTER TABLE servicio_items ALTER COLUMN proveedor_id DROP NOT NULL;
