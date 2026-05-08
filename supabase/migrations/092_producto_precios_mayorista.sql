-- Migration 092: Tiers de precio mayorista por producto
CREATE TABLE producto_precios_mayorista (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_minima INT  NOT NULL CHECK (cantidad_minima > 0),
  precio          DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
  descripcion     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_id, cantidad_minima)
);

ALTER TABLE producto_precios_mayorista ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppm_tenant ON producto_precios_mayorista FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_ppm_producto ON producto_precios_mayorista(producto_id);
