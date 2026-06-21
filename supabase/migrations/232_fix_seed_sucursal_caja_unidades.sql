-- Migration 232: 🔴 FIX regresión del seed — restaurar Sucursal 1 + Caja Principal + unidades
-- =============================================================================================
-- REGRESIÓN: las migs 114/148 tenían `fn_seed_tenant_defaults` creando Sucursal 1 + Caja
-- Principal + 6 unidades de medida predefinidas. La mig 225 (Efectivo por default) reescribió
-- la función con CREATE OR REPLACE para agregar la cuenta Efectivo + métodos de pago, pero
-- **perdió** la creación de sucursal/caja/unidades. Desde el 2026-06-18 TODO tenant nuevo nace
-- sin sucursal, sin caja operativa y sin unidades → no puede operar sin configurar a mano.
-- Detectado validando un alta desde cero (UAT primer uso). Afecta tenants reales en PROD
-- (p.ej. "El muller", creado el 2026-06-20: 0 sucursales, 0 unidades).
--
-- FIX: reescribir fn_seed_tenant_defaults con el set COMPLETO (sucursal + caja + motivos +
-- estados + unidades + Efectivo + métodos) y backfillear los tenants afectados. Aditivo,
-- idempotente. DEV + PROD.

CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  -- Sucursal 1 por defecto (restaurado — mig 114/148)
  v_sucursal_id := gen_random_uuid();
  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  -- Caja Principal asignada a la Sucursal 1 (restaurado — mig 114/148)
  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  -- Motivos de movimiento
  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  -- Estados de inventario
  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  -- Unidades de medida predefinidas (restaurado — mig 148)
  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',   true, true),
    (NEW.id, 'Kilogramo',  'kg',  true, true),
    (NEW.id, 'Gramo',      'g',   true, true),
    (NEW.id, 'Litro',      'L',   true, true),
    (NEW.id, 'Metro',      'm',   true, true),
    (NEW.id, 'Caja',       'caja',true, true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  -- Cuenta de origen Efectivo + métodos de pago (mig 225)
  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ─── Backfill de tenants afectados por la regresión (idempotente) ──────────────────────────
-- 1) Sucursal 1 para tenants sin ninguna sucursal
INSERT INTO sucursales (id, tenant_id, nombre, activo)
SELECT gen_random_uuid(), t.id, 'Sucursal 1', true
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.tenant_id = t.id);

-- 2) Caja Principal para tenants sin caja operativa (excluye la bóveda); linkeada a su sucursal
INSERT INTO cajas (tenant_id, nombre, sucursal_id)
SELECT t.id, 'Caja Principal',
       (SELECT s.id FROM sucursales s WHERE s.tenant_id = t.id ORDER BY s.created_at LIMIT 1)
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cajas c WHERE c.tenant_id = t.id AND COALESCE(c.es_caja_fuerte, false) = false
);

-- 3) Unidades de medida predefinidas para tenants que no las tengan
INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida)
SELECT t.id, u.nombre, u.simbolo, true, true
FROM tenants t
CROSS JOIN (VALUES ('Unidad','u'),('Kilogramo','kg'),('Gramo','g'),('Litro','L'),('Metro','m'),('Caja','caja')) AS u(nombre, simbolo)
WHERE NOT EXISTS (SELECT 1 FROM unidades_medida um WHERE um.tenant_id = t.id AND um.predefinida = true)
ON CONFLICT (tenant_id, nombre) DO UPDATE SET predefinida = true;
