-- Migration 096: costo de envío en OC + contactos múltiples de proveedor

-- Costo de envío en OC
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tiene_envio BOOLEAN NOT NULL DEFAULT false;

-- Tabla de contactos de proveedor (múltiples por proveedor)
CREATE TABLE IF NOT EXISTS proveedor_contactos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  puesto      TEXT,
  email       TEXT,
  telefono    TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_contactos_prov ON proveedor_contactos(proveedor_id);

ALTER TABLE proveedor_contactos ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "tenant_isolation" ON proveedor_contactos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
