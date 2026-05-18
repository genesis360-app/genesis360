-- Migration 112: ISS-124 — Valores por default al crear un nuevo negocio
-- Crea motivos de movimiento y estados de inventario básicos automáticamente
-- al registrar un tenant nuevo. SECURITY DEFINER para omitir RLS durante el INSERT.

CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Motivos de movimiento ──────────────────────────────────────────────────

  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    -- Ingreso de stock
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    -- Rebaje de stock
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    -- Movimientos de caja
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    -- Aplica a ingreso y rebaje
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  -- ── Estados de inventario ──────────────────────────────────────────────────

  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_tenant_defaults ON tenants;
CREATE TRIGGER trg_seed_tenant_defaults
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_seed_tenant_defaults();

-- ── Backfill: tenants existentes sin motivos ni estados ───────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT id FROM tenants
    WHERE id NOT IN (SELECT DISTINCT tenant_id FROM motivos_movimiento)
  LOOP
    INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
      (t.id, 'Compra a proveedor',     'ingreso', true),
      (t.id, 'Ingreso inicial',         'ingreso', true),
      (t.id, 'Devolución de cliente',   'ingreso', true),
      (t.id, 'Venta',                   'rebaje', true),
      (t.id, 'Merma / Rotura',          'rebaje', true),
      (t.id, 'Consumo interno',         'rebaje', true),
      (t.id, 'Vencimiento',             'rebaje', true),
      (t.id, 'Ingreso de efectivo',     'caja',   true),
      (t.id, 'Extracción / Retiro',     'caja',   true),
      (t.id, 'Gastos varios',           'caja',   true),
      (t.id, 'Ajuste de inventario',    'ambos',  true);
  END LOOP;

  FOR t IN
    SELECT id FROM tenants
    WHERE id NOT IN (SELECT DISTINCT tenant_id FROM estados_inventario)
  LOOP
    INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
      (t.id, 'Disponible', '#22c55e', false, true,  true,  true),
      (t.id, 'Bloqueado',  '#ef4444', false, false, false, false);
  END LOOP;
END $$;
