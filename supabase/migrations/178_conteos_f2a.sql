-- ============================================================
-- Migration 178 — Conteos 2.0 · Fase F2a
--   Modos de conteo (rápido/guiado/elegir), conteo a ciegas, filas en blanco,
--   y secuencia de recorrido en ubicaciones (orden de conteo + picking).
--   Aditiva e idempotente.
-- ============================================================

-- 1. Modo de conteo por tenant (config). 'guiado' = conteo a ciegas + paso a paso.
--    'elegir' = el operador decide al crear cada conteo.  (B1 / I2 del relevamiento)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_modo TEXT NOT NULL DEFAULT 'rapido';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tenants_conteo_modo_check' AND table_name = 'tenants') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_conteo_modo_check
      CHECK (conteo_modo IN ('rapido', 'guiado', 'elegir'));
  END IF;
END $$;

-- 2. Secuencia de recorrido físico de la ubicación (I3): ordena el conteo y el picking.
--    Distinto de `prioridad` (orden de rebaje al vender). Nullable; menor = primero.
ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS secuencia INTEGER;

-- 3. Modo efectivo con el que se realizó cada conteo (rápido = informado, guiado = a ciegas).
ALTER TABLE inventario_conteos
  ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'rapido';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventario_conteos_modo_check' AND table_name = 'inventario_conteos') THEN
    ALTER TABLE inventario_conteos ADD CONSTRAINT inventario_conteos_modo_check
      CHECK (modo IN ('rapido', 'guiado'));
  END IF;
END $$;

-- 4. cantidad_contada pasa a NULLABLE para distinguir "no contada" (NULL) de "contada en 0" (B3).
--    En modo a ciegas, las filas no tocadas quedan NULL → se omiten del ajuste.
ALTER TABLE inventario_conteo_items
  ALTER COLUMN cantidad_contada DROP NOT NULL;
