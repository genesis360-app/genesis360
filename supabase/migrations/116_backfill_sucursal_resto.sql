-- Migration 116: Backfill sucursal_id en recepciones, ordenes_compra y movimientos_stock
-- Facturación AFIP no tiene tabla propia con sucursal_id (usa ventas, ya cubierto en 115).

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

    UPDATE recepciones      SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
    UPDATE ordenes_compra   SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
    UPDATE movimientos_stock SET sucursal_id = v_suc_id WHERE tenant_id = t.id AND sucursal_id IS NULL;
  END LOOP;
END $$;
