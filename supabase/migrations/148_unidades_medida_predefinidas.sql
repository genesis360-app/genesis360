-- Migration 148: ISS-180 — Unidades de medida predefinidas (no eliminables)

-- Agregar columna predefinida
ALTER TABLE unidades_medida
  ADD COLUMN IF NOT EXISTS predefinida BOOLEAN NOT NULL DEFAULT false;

-- Actualizar fn_seed_tenant_defaults para incluir unidades predefinidas
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

  -- Unidades de medida predefinidas
  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',   true, true),
    (NEW.id, 'Kilogramo',  'kg',  true, true),
    (NEW.id, 'Gramo',      'g',   true, true),
    (NEW.id, 'Litro',      'L',   true, true),
    (NEW.id, 'Metro',      'm',   true, true),
    (NEW.id, 'Caja',       'caja',true, true);

  RETURN NEW;
END;
$$;

-- Backfill: tenants existentes sin unidades predefinidas
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT id FROM tenants
    WHERE id NOT IN (
      SELECT DISTINCT tenant_id FROM unidades_medida WHERE predefinida = true
    )
  LOOP
    INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida)
    VALUES
      (t.id, 'Unidad',     'u',   true, true),
      (t.id, 'Kilogramo',  'kg',  true, true),
      (t.id, 'Gramo',      'g',   true, true),
      (t.id, 'Litro',      'L',   true, true),
      (t.id, 'Metro',      'm',   true, true),
      (t.id, 'Caja',       'caja',true, true)
    ON CONFLICT (tenant_id, nombre) DO UPDATE SET predefinida = true;
  END LOOP;
END $$;
