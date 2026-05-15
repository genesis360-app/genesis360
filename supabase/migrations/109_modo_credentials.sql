-- Migration 109: MODO payments integration (ISS-072)

CREATE TABLE IF NOT EXISTS modo_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  merchant_id  TEXT NOT NULL,
  api_key      TEXT NOT NULL,
  ambiente     TEXT NOT NULL DEFAULT 'test' CHECK (ambiente IN ('test', 'prod')),
  conectado    BOOLEAN NOT NULL DEFAULT false,
  conectado_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

ALTER TABLE modo_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modo_credentials' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON modo_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_modo_credentials_tenant ON modo_credentials(tenant_id);
