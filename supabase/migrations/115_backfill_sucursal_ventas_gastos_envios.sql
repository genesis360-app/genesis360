-- Migration 115: Backfill sucursal_id en ventas, gastos y envíos
-- Asigna la sucursal más antigua del tenant a todos los registros sin sucursal_id.

DO $$
DECLARE
  t RECORD;
  v_suc_id UUID;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    SELECT id INTO v_suc_id
    FROM sucursales
    WHERE tenant_id = t.id AND activo = true
    ORDER BY created_at ASC LIMIT 1;

    IF v_suc_id IS NULL THEN CONTINUE; END IF;

    UPDATE ventas  SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
    UPDATE gastos  SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
    UPDATE envios  SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
  END LOOP;
END $$;
