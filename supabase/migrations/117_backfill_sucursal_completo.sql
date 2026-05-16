-- Migration 117: Backfill sucursal_id — limpieza completa
-- Tablas con NULL intencional (no tocar):
--   clientes, proveedores  → globales por diseño (ISS-102)
--   users                  → roles globales tienen NULL
--   ubicaciones, combos    → pueden ser globales (sin sucursal = disponible a todas)

-- ── caja_sesiones: tomar sucursal_id de la caja asociada ─────────────────────
UPDATE caja_sesiones cs
SET sucursal_id = c.sucursal_id
FROM cajas c
WHERE cs.caja_id = c.id
  AND cs.sucursal_id IS NULL
  AND c.sucursal_id IS NOT NULL;

-- ── cajas operativas restantes sin sucursal → sucursal más antigua del tenant ─
DO $$
DECLARE r RECORD; v UUID;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id FROM cajas WHERE sucursal_id IS NULL AND es_caja_fuerte = false LOOP
    SELECT id INTO v FROM sucursales WHERE tenant_id = r.tenant_id AND activo = true ORDER BY created_at LIMIT 1;
    IF v IS NOT NULL THEN
      UPDATE cajas SET sucursal_id = v WHERE tenant_id = r.tenant_id AND sucursal_id IS NULL AND es_caja_fuerte = false;
    END IF;
  END LOOP;
END $$;

-- ── Tablas operativas: sucursal más antigua del tenant ───────────────────────
DO $$
DECLARE r RECORD; v UUID;
BEGIN
  FOR r IN SELECT id FROM tenants LOOP
    SELECT id INTO v FROM sucursales WHERE tenant_id = r.id AND activo = true ORDER BY created_at LIMIT 1;
    IF v IS NULL THEN CONTINUE; END IF;

    UPDATE inventario_lineas   SET sucursal_id = v WHERE tenant_id = r.id AND sucursal_id IS NULL;
    UPDATE inventario_conteos  SET sucursal_id = v WHERE tenant_id = r.id AND sucursal_id IS NULL;
    UPDATE recursos            SET sucursal_id = v WHERE tenant_id = r.id AND sucursal_id IS NULL;
    UPDATE puntos_venta_afip   SET sucursal_id = v WHERE tenant_id = r.id AND sucursal_id IS NULL;
  END LOOP;
END $$;
