-- ============================================================
-- Migration 182 — Compras · CO1 (Gobierno de OC)
--   A2 aprobación por umbral · A4 sucursal obligatoria (app) · A5 numeración
--   configurable (default por sucursal) · D5 permisos de pago (doble firma).
--   Aditiva e idempotente. Sin DDL destructivo.
-- ============================================================

-- A2 — aprobación de OC antes de enviar (por umbral de monto, configurable).
-- A5 — numeración configurable.  D5 — doble firma de pago por umbral.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS oc_aprobacion_activa BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oc_aprobacion_umbral NUMERIC,
  ADD COLUMN IF NOT EXISTS oc_numeracion TEXT NOT NULL DEFAULT 'sucursal',
  ADD COLUMN IF NOT EXISTS oc_pago_doble_firma_umbral NUMERIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tenants_oc_numeracion_check' AND table_name = 'tenants') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_oc_numeracion_check
      CHECK (oc_numeracion IN ('tenant', 'sucursal', 'proveedor'));
  END IF;
END $$;

-- A2 — estado de aprobación de la OC.  A5 — correlativo por sucursal.
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS numero_sucursal INTEGER,
  ADD COLUMN IF NOT EXISTS requiere_aprobacion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aprobada_por UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS aprobada_at TIMESTAMPTZ;

-- A5 — el trigger de numeración ahora también asigna el correlativo por sucursal
-- (igual patrón que ventas). El número por tenant se mantiene como id interno.
CREATE OR REPLACE FUNCTION set_oc_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM ordenes_compra WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
      FROM ordenes_compra WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.set_oc_numero() SET search_path = public;
