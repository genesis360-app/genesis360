-- Migration 159: F5 — correlativo independiente de presupuestos por sucursal (PRES-NNNN)
-- Relevamiento Ventas F5 (B+C): numeración propia con prefijo + por sucursal.
-- El presupuesto recibe su propio correlativo (presupuesto_numero / _sucursal) que NO
-- toca el correlativo de ventas reales. Se asigna solo cuando la venta nace como
-- presupuesto (estado='pendiente'); se conserva si luego se convierte en venta.

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS presupuesto_numero          INTEGER,
  ADD COLUMN IF NOT EXISTS presupuesto_numero_sucursal INTEGER;

-- Trigger: además del numero global/sucursal, asigna el correlativo de presupuesto.
CREATE OR REPLACE FUNCTION gen_venta_numero()
RETURNS TRIGGER AS $$
BEGIN
  -- número global por tenant (backward-compat)
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id;
  END IF;
  -- número local por sucursal
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  -- F5: correlativo independiente de presupuestos (solo si nace como presupuesto)
  IF NEW.estado = 'pendiente' AND NEW.presupuesto_numero IS NULL THEN
    SELECT COALESCE(MAX(presupuesto_numero), 0) + 1 INTO NEW.presupuesto_numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND presupuesto_numero IS NOT NULL;
    IF NEW.sucursal_id IS NOT NULL THEN
      SELECT COALESCE(MAX(presupuesto_numero_sucursal), 0) + 1 INTO NEW.presupuesto_numero_sucursal
      FROM ventas
      WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id
        AND presupuesto_numero_sucursal IS NOT NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill: presupuestos existentes (estado='pendiente') reciben correlativo por
-- orden de creación, por tenant (global) y por tenant+sucursal.
-- Se deshabilita temporalmente el guard de período contable cerrado: el backfill
-- solo escribe el correlativo de presupuesto, no altera importes ni la venta contable.
ALTER TABLE ventas DISABLE TRIGGER trg_ventas_cierre;

WITH num_global AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM ventas
  WHERE estado = 'pendiente'
)
UPDATE ventas v
  SET presupuesto_numero = n.rn
FROM num_global n
WHERE v.id = n.id AND v.presupuesto_numero IS NULL;

WITH num_suc AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, sucursal_id ORDER BY created_at, id) AS rn
  FROM ventas
  WHERE estado = 'pendiente' AND sucursal_id IS NOT NULL
)
UPDATE ventas v
  SET presupuesto_numero_sucursal = n.rn
FROM num_suc n
WHERE v.id = n.id AND v.presupuesto_numero_sucursal IS NULL;

ALTER TABLE ventas ENABLE TRIGGER trg_ventas_cierre;
