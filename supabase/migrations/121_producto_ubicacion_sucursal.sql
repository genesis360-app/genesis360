-- Migration 121: Ubicación predeterminada por producto × sucursal
-- Sigue el mismo patrón que producto_stock_minimo_sucursal.
-- El campo productos.ubicacion_id sigue como fallback global (negocios mono-branch).

CREATE TABLE IF NOT EXISTS producto_ubicacion_sucursal (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  ubicacion_id UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (producto_id, sucursal_id)
);

ALTER TABLE producto_ubicacion_sucursal ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'producto_ubicacion_sucursal' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY "tenant_isolation" ON producto_ubicacion_sucursal
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prod_ubic_suc_producto ON producto_ubicacion_sucursal(producto_id);
CREATE INDEX IF NOT EXISTS idx_prod_ubic_suc_tenant   ON producto_ubicacion_sucursal(tenant_id);
