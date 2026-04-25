-- Migration 065: Integración MercadoLibre
-- Credenciales OAuth por tenant/sucursal + mapeo producto ↔ ML item

-- Credenciales ML del seller
CREATE TABLE IF NOT EXISTS meli_credentials (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id   UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  seller_id     BIGINT NOT NULL,
  seller_nickname TEXT,
  seller_email  TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  conectado     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id)
);

CREATE INDEX idx_meli_credentials_tenant ON meli_credentials(tenant_id);
CREATE INDEX idx_meli_credentials_expires ON meli_credentials(expires_at) WHERE conectado = TRUE;

-- Trigger updated_at
CREATE TRIGGER trg_updated_at_meli_cred
  BEFORE UPDATE ON meli_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Mapeo producto Genesis360 ↔ ML item
CREATE TABLE IF NOT EXISTS inventario_meli_map (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  meli_item_id    TEXT NOT NULL,          -- ej: MLA1234567890
  meli_variation_id BIGINT,              -- nullable: solo si tiene variaciones
  sync_stock      BOOLEAN NOT NULL DEFAULT TRUE,
  sync_precio     BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_sync_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, producto_id, meli_item_id)
);

CREATE INDEX idx_meli_map_tenant    ON inventario_meli_map(tenant_id);
CREATE INDEX idx_meli_map_producto  ON inventario_meli_map(producto_id);
CREATE INDEX idx_meli_map_item      ON inventario_meli_map(meli_item_id);

-- RLS
ALTER TABLE meli_credentials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_meli_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY meli_cred_tenant    ON meli_credentials    USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY meli_map_tenant     ON inventario_meli_map USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Trigger sync stock MELI: cuando cambia inventario_lineas → encolar job
CREATE OR REPLACE FUNCTION fn_enqueue_meli_stock_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
  v_producto_id UUID;
BEGIN
  v_tenant_id  := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);

  IF v_tenant_id IS NULL OR v_producto_id IS NULL THEN RETURN NEW; END IF;

  -- Solo encolar si hay mapeo MELI para este producto
  IF NOT EXISTS (
    SELECT 1 FROM inventario_meli_map
    WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE
  ) THEN RETURN NEW; END IF;

  INSERT INTO integration_job_queue (tenant_id, integracion, tipo, payload, status, next_attempt_at)
  SELECT v_tenant_id, 'MercadoLibre', 'sync_stock',
         jsonb_build_object('producto_id', v_producto_id, 'meli_item_id', meli_item_id, 'meli_variation_id', meli_variation_id),
         'pending', NOW()
  FROM inventario_meli_map
  WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_meli_stock_sync
  AFTER INSERT OR UPDATE OR DELETE ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_meli_stock_sync();
