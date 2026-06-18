-- Migration 225: Efectivo por default en el alta de tenant
-- Pedido GO (2026-06-18): cada tenant nuevo debe tener, por default:
--   1) una Cuenta de Origen "Efectivo" (tipo 'efectivo', en la moneda del tenant)
--   2) el método de pago "Efectivo" vinculado a esa cuenta
--
-- Se extiende el seed de onboarding fn_seed_tenant_defaults (mig 112). DEBE ser
-- SECURITY DEFINER + search_path=public: el trigger AFTER INSERT ON tenants corre ANTES
-- de que exista la fila en users, así que la RLS de cuentas_origen/metodos_pago
-- rechazaría el INSERT si no fuera DEFINER (gotcha del bug de mig 166).
--
-- Antes los métodos de pago default se creaban "lazy" recién al abrir Config→Ventas
-- (sin cuenta vinculada). Ahora el tenant nace con los 5 métodos y con Efectivo
-- vinculado a su cuenta. El seed lazy de ConfigPage queda solo como fallback para
-- tenants viejos sin métodos.

CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_efectivo_cuenta_id uuid;
BEGIN
  -- ── Motivos de movimiento ──────────────────────────────────────────────────
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

  -- ── Estados de inventario ──────────────────────────────────────────────────
  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  -- ── Cuenta de Origen Efectivo (tipo efectivo, en la moneda del tenant) ───────
  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  -- ── Métodos de pago default (Efectivo vinculado a la cuenta Efectivo) ────────
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

-- El trigger trg_seed_tenant_defaults ya existe (mig 112); CREATE OR REPLACE actualiza
-- la función que ejecuta.

-- ── Backfill 1: tenants existentes sin Cuenta de Origen Efectivo ──────────────
DO $$
DECLARE
  t RECORD;
  v_id uuid;
BEGIN
  FOR t IN
    SELECT tt.id, COALESCE(tt.moneda, 'ARS') AS moneda FROM tenants tt
    WHERE NOT EXISTS (
      SELECT 1 FROM cuentas_origen co
      WHERE co.tenant_id = tt.id AND lower(co.nombre) = 'efectivo'
    )
  LOOP
    INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
    VALUES (t.id, 'Efectivo', 'efectivo', t.moneda, true)
    RETURNING id INTO v_id;
  END LOOP;
END $$;

-- ── Backfill 2: vincular el método Efectivo (si existe) a la cuenta Efectivo ──
UPDATE metodos_pago mp
SET cuenta_origen_id = co.id
FROM cuentas_origen co
WHERE mp.tenant_id = co.tenant_id
  AND lower(co.nombre) = 'efectivo'
  AND lower(mp.nombre) = 'efectivo'
  AND mp.cuenta_origen_id IS NULL;
