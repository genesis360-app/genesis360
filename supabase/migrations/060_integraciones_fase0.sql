-- ─── Migration 060: Fase 0 — Fundamentos de Integraciones ───────────────────
-- Prerequisito para todas las integraciones externas (MELI, TN, MP, etc.)
-- 1. pgcrypto (encriptación de tokens)
-- 2. ventas — columnas adicionales para e-commerce
-- 3. clientes — normalización y marketing
-- 4. integration_job_queue — cola genérica async
-- 5. ventas_externas_logs — idempotencia de webhooks
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. pgcrypto (necesario para PGP_SYM_ENCRYPT en tablas de credenciales)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ventas — columnas para origen, tracking y facturación
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'POS',
  ADD COLUMN IF NOT EXISTS tracking_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS costo_envio_logistica DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS marketing_metadata JSONB,
  ADD COLUMN IF NOT EXISTS id_pago_externo TEXT,
  ADD COLUMN IF NOT EXISTS money_release_date DATE,
  ADD COLUMN IF NOT EXISTS cae VARCHAR,
  ADD COLUMN IF NOT EXISTS vencimiento_cae DATE,
  ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS link_factura_pdf TEXT;

-- origen: de dónde vino la venta
ALTER TABLE ventas
  ADD CONSTRAINT ventas_origen_check
  CHECK (origen IN ('POS', 'MELI', 'TiendaNube', 'Shopify', 'WooCommerce', 'MP'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. clientes — normalización de teléfono y optin de marketing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS telefono_normalizado TEXT,
  ADD COLUMN IF NOT EXISTS marketing_optin BOOLEAN DEFAULT TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. integration_job_queue — cola async genérica para todas las integraciones
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_job_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  integracion     TEXT NOT NULL,  -- 'meli' | 'tiendanube' | 'mp' | 'andreani' | etc.
  tipo            TEXT NOT NULL,  -- 'sync_stock' | 'sync_precio' | 'crear_envio' | etc.
  payload         JSONB NOT NULL DEFAULT '{}',
  endpoint        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  retries         INT NOT NULL DEFAULT 0,
  max_retries     INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_last      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON integration_job_queue (tenant_id, integracion, next_attempt_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE integration_job_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_job_queue' AND policyname = 'job_queue_tenant'
  ) THEN
    CREATE POLICY job_queue_tenant ON integration_job_queue
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_job_queue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_job_queue ON integration_job_queue;
CREATE TRIGGER trg_updated_at_job_queue
  BEFORE UPDATE ON integration_job_queue
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_job_queue();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ventas_externas_logs — idempotencia de webhooks entrantes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventas_externas_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integracion          TEXT NOT NULL,  -- 'meli' | 'tiendanube' | 'mp' | etc.
  webhook_external_id  TEXT NOT NULL,  -- ID único del evento en la plataforma externa
  venta_id             UUID REFERENCES ventas(id) ON DELETE SET NULL,
  payload_raw          JSONB,
  procesado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, integracion, webhook_external_id)
);

CREATE INDEX IF NOT EXISTS idx_ventas_externas_logs_lookup
  ON ventas_externas_logs (tenant_id, integracion, webhook_external_id);

ALTER TABLE ventas_externas_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ventas_externas_logs' AND policyname = 'ventas_externas_tenant'
  ) THEN
    CREATE POLICY ventas_externas_tenant ON ventas_externas_logs
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
