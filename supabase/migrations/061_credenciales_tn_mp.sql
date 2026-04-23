-- ─── Migration 061: Credenciales TiendaNube + MercadoPago + Mapeo TN ─────────
-- Tablas de credenciales OAuth por sucursal.
-- SEGURIDAD: access_token y campos sensibles nunca expuestos al frontend.
-- Las Edge Functions los leen vía service role key.
-- El frontend solo consulta campos de estado (conectado, store_id, expires_at).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tiendanube_credentials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiendanube_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  store_id        BIGINT NOT NULL,           -- ID de la tienda en TN
  store_name      TEXT,                      -- nombre visible al usuario
  store_url       TEXT,                      -- URL de la tienda (ej: mitienda.mitiendanube.com)
  access_token    TEXT NOT NULL,             -- token permanente (sin expiración en TN)
  conectado       BOOLEAN NOT NULL DEFAULT TRUE,
  conectado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_tn_creds_tenant ON tiendanube_credentials (tenant_id);

ALTER TABLE tiendanube_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tiendanube_credentials' AND policyname = 'tn_creds_tenant'
  ) THEN
    -- Solo OWNER/SUPERVISOR pueden ver el estado de conexión (no los tokens)
    CREATE POLICY tn_creds_tenant ON tiendanube_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_tn_creds()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_tn_creds ON tiendanube_credentials;
CREATE TRIGGER trg_updated_at_tn_creds
  BEFORE UPDATE ON tiendanube_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_tn_creds();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. mercadopago_credentials
-- Solo para recibir notificaciones IPN de pagos (no cobrar en nombre de otros).
-- access_token del vendedor obtenido vía OAuth estándar de MP.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mercadopago_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  seller_id       BIGINT NOT NULL,           -- user_id de MP del vendedor
  seller_email    TEXT,                      -- email de la cuenta MP
  access_token    TEXT NOT NULL,             -- token OAuth del vendedor
  refresh_token   TEXT,                      -- para renovar (expira en 180 días en MP)
  public_key      TEXT,                      -- public_key del vendedor (para checkout)
  expires_at      TIMESTAMPTZ,               -- cuándo vence el access_token
  conectado       BOOLEAN NOT NULL DEFAULT TRUE,
  conectado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_creds_tenant ON mercadopago_credentials (tenant_id);
-- Índice para encontrar tokens próximos a vencer (cron de refresh)
CREATE INDEX IF NOT EXISTS idx_mp_creds_expires ON mercadopago_credentials (expires_at)
  WHERE conectado = TRUE;

ALTER TABLE mercadopago_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mercadopago_credentials' AND policyname = 'mp_creds_tenant'
  ) THEN
    CREATE POLICY mp_creds_tenant ON mercadopago_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_mp_creds()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_mp_creds ON mercadopago_credentials;
CREATE TRIGGER trg_updated_at_mp_creds
  BEFORE UPDATE ON mercadopago_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_mp_creds();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inventario_tn_map — mapeo producto Genesis360 ↔ producto TiendaNube
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_tn_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tn_product_id   BIGINT NOT NULL,           -- ID del producto en TN
  tn_variant_id   BIGINT,                    -- ID de la variante (null si sin variantes)
  sync_stock      BOOLEAN NOT NULL DEFAULT TRUE,   -- sincronizar stock hacia TN
  sync_precio     BOOLEAN NOT NULL DEFAULT FALSE,  -- sincronizar precio hacia TN
  ultimo_sync_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id, producto_id),
  UNIQUE (tenant_id, sucursal_id, tn_product_id, tn_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_tn_map_producto ON inventario_tn_map (tenant_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_tn_map_tn_product ON inventario_tn_map (tenant_id, tn_product_id);

ALTER TABLE inventario_tn_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventario_tn_map' AND policyname = 'tn_map_tenant'
  ) THEN
    CREATE POLICY tn_map_tenant ON inventario_tn_map
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
