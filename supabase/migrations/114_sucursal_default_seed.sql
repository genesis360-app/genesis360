-- Migration 114: Sucursal por defecto al crear negocio + backfill cajas existentes

-- ── 1. Actualizar fn_seed_tenant_defaults: agrega creación de Sucursal 1 ─────
CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sucursal_id UUID;
BEGIN
  -- Sucursal 1 por defecto
  v_sucursal_id := gen_random_uuid();
  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  -- Caja principal asignada a la sucursal 1
  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  -- Motivos de movimiento
  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',  'ingreso', true),
    (NEW.id, 'Ingreso inicial',      'ingreso', true),
    (NEW.id, 'Devolución de cliente','ingreso', true),
    (NEW.id, 'Venta',                'rebaje',  true),
    (NEW.id, 'Merma / Rotura',       'rebaje',  true),
    (NEW.id, 'Consumo interno',      'rebaje',  true),
    (NEW.id, 'Vencimiento',          'rebaje',  true),
    (NEW.id, 'Ingreso de efectivo',  'caja',    true),
    (NEW.id, 'Extracción / Retiro',  'caja',    true),
    (NEW.id, 'Gastos varios',        'caja',    true),
    (NEW.id, 'Ajuste de inventario', 'ambos',   true);

  -- Estados de inventario
  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  RETURN NEW;
END;
$$;

-- ── 2. Backfill: tenants con múltiples sucursales → asignar la más antigua a cajas sin asignar ──
DO $$
DECLARE
  r RECORD;
  v_primera_suc UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT t.id AS tenant_id
    FROM tenants t
    WHERE (SELECT COUNT(*) FROM sucursales s WHERE s.tenant_id = t.id AND s.activo = true) >= 2
      AND EXISTS (SELECT 1 FROM cajas c WHERE c.tenant_id = t.id AND c.sucursal_id IS NULL AND c.es_caja_fuerte = false AND c.activo = true)
  LOOP
    SELECT id INTO v_primera_suc
    FROM sucursales WHERE tenant_id = r.tenant_id AND activo = true
    ORDER BY created_at ASC LIMIT 1;

    IF v_primera_suc IS NOT NULL THEN
      UPDATE cajas
      SET sucursal_id = v_primera_suc
      WHERE tenant_id = r.tenant_id
        AND sucursal_id IS NULL
        AND es_caja_fuerte = false
        AND activo = true;
    END IF;
  END LOOP;
END $$;

-- ── 3. Backfill: tenants SIN ninguna sucursal → crear Sucursal 1 + asignar cajas ──
DO $$
DECLARE
  r RECORD;
  v_suc_id UUID;
BEGIN
  FOR r IN
    SELECT id FROM tenants
    WHERE NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.tenant_id = tenants.id AND s.activo = true)
  LOOP
    v_suc_id := gen_random_uuid();
    INSERT INTO sucursales (id, tenant_id, nombre, activo)
    VALUES (v_suc_id, r.id, 'Sucursal 1', true);

    -- Asignar cajas operativas sin sucursal a esta nueva sucursal
    UPDATE cajas
    SET sucursal_id = v_suc_id
    WHERE tenant_id = r.id
      AND sucursal_id IS NULL
      AND es_caja_fuerte = false
      AND activo = true;
  END LOOP;
END $$;
