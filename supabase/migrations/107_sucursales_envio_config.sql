-- Migration 107: configuración de envíos por sucursal
-- 1. costo_km_envio en sucursales (varía por sucursal)
-- 2. Tabla courier_tarifas para precios de couriers por sucursal

ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS costo_km_envio DECIMAL(10,2) DEFAULT 0;

-- Tarifas de couriers por tenant/sucursal
CREATE TABLE IF NOT EXISTS courier_tarifas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id  UUID REFERENCES sucursales(id) ON DELETE CASCADE,
  courier      TEXT NOT NULL,
  precio       DECIMAL(10,2) NOT NULL DEFAULT 0,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, sucursal_id, courier)
);

ALTER TABLE courier_tarifas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'courier_tarifas' AND policyname = 'courier_tarifas_tenant'
  ) THEN
    CREATE POLICY courier_tarifas_tenant ON courier_tarifas
      FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_courier_tarifas_tenant ON courier_tarifas(tenant_id, sucursal_id);
