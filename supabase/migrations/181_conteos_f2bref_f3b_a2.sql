-- ============================================================
-- Migration 181 — Conteos 2.0 · cierre (F2b-ref + F3b + A2)
--   F2b-ref: ítems fuera de alcance escaneados (mercadería mal ubicada).
--   F3b: snapshot de costo por ítem + doble conteo formal (2º ingreso + operador).
--   A2: bloqueo de movimientos durante wall-to-wall.
--   Aditiva e idempotente. Sin DDL destructivo.
-- ============================================================

-- F2b-ref (E3) — el ítem se contó aunque cae fuera del alcance del conteo.
ALTER TABLE inventario_conteo_items
  ADD COLUMN IF NOT EXISTS fuera_de_scope BOOLEAN NOT NULL DEFAULT false;

-- F3b — snapshot del costo unitario al momento de cargar la línea (valorización estable
-- aunque después cambie precio_costo) + doble conteo formal (segundo ingreso + operador).
ALTER TABLE inventario_conteo_items
  ADD COLUMN IF NOT EXISTS costo_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS cantidad_reconteo NUMERIC,
  ADD COLUMN IF NOT EXISTS reconteo_por UUID REFERENCES users(id);

-- A2 — wall-to-wall puede bloquear ventas/movimientos de la sucursal hasta cerrar el conteo.
ALTER TABLE inventario_conteos
  ADD COLUMN IF NOT EXISTS bloquea_movimientos BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_wall_to_wall_bloquea BOOLEAN NOT NULL DEFAULT false;

-- Índice para el gate de movimientos: conteo full en curso (borrador) que bloquea, por sucursal.
CREATE INDEX IF NOT EXISTS idx_conteos_bloqueo
  ON inventario_conteos(tenant_id, sucursal_id, estado)
  WHERE bloquea_movimientos = true;
