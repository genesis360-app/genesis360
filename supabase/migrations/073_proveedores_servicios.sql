-- Migration 073: Proveedores/Servicios — extensión del módulo existente

-- Nuevos campos en proveedores
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tipo           TEXT DEFAULT 'proveedor' CHECK (tipo IN ('proveedor','servicio'));
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS dni            TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS codigo_fiscal  TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS etiquetas      TEXT[];

-- Productos que vende cada proveedor (many-to-many con precios)
CREATE TABLE IF NOT EXISTS proveedor_productos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id  UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio_compra DECIMAL(12,2),
  cantidad_minima INT DEFAULT 1,
  costo_envio   DECIMAL(12,2),
  costos_extra  DECIMAL(12,2),
  notas         TEXT,
  UNIQUE(proveedor_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_prov_prod_proveedor ON proveedor_productos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_prov_prod_tenant    ON proveedor_productos(tenant_id);
ALTER TABLE proveedor_productos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_tenant ON proveedor_productos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Servicios que ofrece cada proveedor de tipo 'servicio'
CREATE TABLE IF NOT EXISTS servicio_items (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  detalle      TEXT,
  costo        DECIMAL(12,2),
  forma_pago   TEXT,
  hace_factura BOOLEAN DEFAULT FALSE,
  notas        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_serv_items_prov ON servicio_items(proveedor_id);
ALTER TABLE servicio_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY si_tenant ON servicio_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Presupuestos de servicios (con archivo adjunto)
CREATE TABLE IF NOT EXISTS servicio_presupuestos (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id     UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  servicio_item_id UUID REFERENCES servicio_items(id) ON DELETE SET NULL,
  nombre           TEXT,
  fecha            DATE DEFAULT CURRENT_DATE,
  monto            DECIMAL(12,2),
  archivo_url      TEXT,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presup_prov ON servicio_presupuestos(proveedor_id);
ALTER TABLE servicio_presupuestos ENABLE ROW LEVEL SECURITY;
CREATE POLICY sp_tenant ON servicio_presupuestos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Bucket para presupuestos de servicios
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('presupuestos-servicios', 'presupuestos-servicios', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='presup_serv_read') THEN
    CREATE POLICY presup_serv_read ON storage.objects FOR SELECT
      USING (bucket_id = 'presupuestos-servicios' AND auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='presup_serv_insert') THEN
    CREATE POLICY presup_serv_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'presupuestos-servicios' AND auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='presup_serv_delete') THEN
    CREATE POLICY presup_serv_delete ON storage.objects FOR DELETE
      USING (bucket_id = 'presupuestos-servicios' AND auth.uid() IS NOT NULL);
  END IF;
END $$;
