-- Migration 076: Facturación electrónica AFIP — configuración base

-- Tenants: campos fiscales del emisor
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS facturacion_habilitada  BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS condicion_iva_emisor    TEXT;   -- RI, Monotributista, Exento
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS razon_social_fiscal      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domicilio_fiscal         TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS umbral_factura_b        DECIMAL(12,2) DEFAULT 68305.16; -- RG 5616 (actualizable)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS afipsdk_token           TEXT;   -- access_token de afipsdk.com (solo service role)

-- Clientes: campos fiscales del receptor
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cuit_receptor          TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS condicion_iva_receptor TEXT; -- RI, CF, Monotributista, Exento

-- Puntos de venta AFIP por tenant/sucursal
CREATE TABLE IF NOT EXISTS puntos_venta_afip (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES sucursales(id),
  numero      INT NOT NULL,
  nombre      TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_pv_afip_tenant ON puntos_venta_afip(tenant_id);
ALTER TABLE puntos_venta_afip ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='puntos_venta_afip' AND policyname='pv_tenant') THEN
    CREATE POLICY pv_tenant ON puntos_venta_afip
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Retenciones y percepciones sufridas
CREATE TABLE IF NOT EXISTS retenciones_sufridas (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo          TEXT,          -- Ganancias, IVA, IIBB, Suss, etc.
  agente        TEXT,          -- Nombre/CUIT del agente retenedor
  monto         DECIMAL(12,2),
  fecha         DATE DEFAULT CURRENT_DATE,
  periodo       TEXT,          -- YYYY-MM
  certificado_url TEXT,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ret_tenant ON retenciones_sufridas(tenant_id);
ALTER TABLE retenciones_sufridas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='retenciones_sufridas' AND policyname='ret_tenant') THEN
    CREATE POLICY ret_tenant ON retenciones_sufridas
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Gastos: marcar si el comprobante ya fue conciliado en Libro IVA Compras
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS conciliado_iva BOOLEAN DEFAULT FALSE;
