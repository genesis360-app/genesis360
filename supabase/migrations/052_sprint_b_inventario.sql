-- Migration 052: Sprint B inventario
-- I-04: stock_minimo por sucursal
-- I-05: mono_sku en ubicaciones
-- I-09: estado "En Armado" en kitting_log

-- ─── I-04: tabla producto_stock_minimo_sucursal ───────────────────────────────
CREATE TABLE IF NOT EXISTS producto_stock_minimo_sucursal (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  stock_minimo INT NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, producto_id, sucursal_id)
);

ALTER TABLE producto_stock_minimo_sucursal ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'producto_stock_minimo_sucursal' AND policyname = 'psmss_tenant'
  ) THEN
    CREATE POLICY "psmss_tenant" ON producto_stock_minimo_sucursal
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_psmss_tenant   ON producto_stock_minimo_sucursal(tenant_id);
CREATE INDEX IF NOT EXISTS idx_psmss_producto ON producto_stock_minimo_sucursal(producto_id);
CREATE INDEX IF NOT EXISTS idx_psmss_sucursal ON producto_stock_minimo_sucursal(sucursal_id);

-- ─── I-05: mono_sku en ubicaciones ───────────────────────────────────────────
-- Cuando es TRUE, la ubicación solo puede tener un SKU a la vez.
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS mono_sku BOOLEAN DEFAULT FALSE;

-- ─── I-09: estado + componentes_reservados en kitting_log ────────────────────
ALTER TABLE kitting_log
  ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'completado';

ALTER TABLE kitting_log
  ADD COLUMN IF NOT EXISTS componentes_reservados JSONB;

ALTER TABLE kitting_log DROP CONSTRAINT IF EXISTS kitting_log_estado_check;
ALTER TABLE kitting_log ADD CONSTRAINT kitting_log_estado_check
  CHECK (estado IN ('en_armado', 'completado', 'cancelado'));

-- Marcar registros existentes como completados
UPDATE kitting_log SET estado = 'completado' WHERE estado IS NULL;

CREATE INDEX IF NOT EXISTS idx_kitting_log_estado ON kitting_log(tenant_id, estado)
  WHERE estado = 'en_armado';
