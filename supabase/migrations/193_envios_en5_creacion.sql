-- Migration 193 — Envíos EN5: creación y alcance (A1-A5)
-- A2 envíos libres (tipo/motivo) · A3 sugerencia courier por CP · A4 plazo despacho por canal
-- A5 múltiples envíos por venta con desglose de ítems (envio_items).
-- A1 (DEPOSITO crea) es solo permiso de UI, sin DDL. Todo aditivo / idempotente.

-- ============================================================
-- 1) envios — tipo + motivo (A2) + sucursal destino (traslado interno)
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS tipo               TEXT NOT NULL DEFAULT 'venta'; -- venta|traslado_interno|muestra|dev_proveedor|otro
ALTER TABLE envios ADD COLUMN IF NOT EXISTS motivo             TEXT;
ALTER TABLE envios ADD COLUMN IF NOT EXISTS sucursal_destino_id UUID REFERENCES sucursales(id) ON DELETE SET NULL;

COMMENT ON COLUMN envios.tipo IS 'EN5/A2: venta (default) | traslado_interno | muestra | dev_proveedor | otro.';

-- ============================================================
-- 2) tenants — config A3/A4
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cp_courier_preferido JSONB NOT NULL DEFAULT '[]'::jsonb;  -- A3 [{cp|desde,hasta, courier}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_plazo_despacho JSONB NOT NULL DEFAULT '{}'::jsonb;  -- A4 {presencial,online,mayorista} en horas

COMMENT ON COLUMN tenants.cp_courier_preferido IS 'EN5/A3: sugerencia de courier por código postal.';
COMMENT ON COLUMN tenants.envio_plazo_despacho IS 'EN5/A4: plazo de despacho en horas por clasificación de canal {presencial,online,mayorista}.';

-- ============================================================
-- 3) envio_items (A5) — desglose de qué se fue en cada envío
-- ============================================================
CREATE TABLE IF NOT EXISTS envio_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id    UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  cantidad    NUMERIC NOT NULL DEFAULT 0,
  lpn         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_envio_items_envio ON envio_items(envio_id);
ALTER TABLE envio_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='envio_items_tenant' AND tablename='envio_items') THEN
    CREATE POLICY "envio_items_tenant" ON envio_items
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
COMMENT ON TABLE envio_items IS 'EN5/A5: desglose de productos/cantidades/LPN que se despacharon en cada envío de una venta (split).';
