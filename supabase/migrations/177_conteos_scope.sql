-- ============================================================
-- Migration 177 — Conteos 2.0 · Fase F1 (scope ampliado)
--   Permite conteos por Marca / Categoría / Sucursal completa (wall-to-wall),
--   además de los tipos existentes (ubicacion / producto).
--   Aditiva e idempotente. No toca datos existentes.
-- ============================================================

-- 1. Ampliar el CHECK de inventario_conteos.tipo con los nuevos alcances.
--    Los conteos viejos ('ubicacion'/'producto') siguen siendo válidos.
ALTER TABLE inventario_conteos DROP CONSTRAINT IF EXISTS inventario_conteos_tipo_check;
ALTER TABLE inventario_conteos
  ADD CONSTRAINT inventario_conteos_tipo_check
  CHECK (tipo IN ('ubicacion', 'producto', 'marca', 'categoria', 'sucursal'));

-- 2. Criterio del conteo cuando el alcance no es una FK directa (marca/categoría/sucursal).
--    Guarda { marca?: text, categoria_id?: uuid, categoria_nombre?: text }.
--    Para 'ubicacion'/'producto' se sigue usando ubicacion_id/producto_id (filtros = {}).
ALTER TABLE inventario_conteos
  ADD COLUMN IF NOT EXISTS filtros JSONB DEFAULT '{}'::jsonb;
