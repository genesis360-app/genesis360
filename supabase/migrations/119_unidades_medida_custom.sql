-- Migration 119: ISS-120 — Unidades de medida personalizables por tenant

CREATE TABLE IF NOT EXISTS unidades_medida (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  simbolo    TEXT,
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);

ALTER TABLE unidades_medida ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'unidades_medida' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON unidades_medida
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_udm_tenant ON unidades_medida(tenant_id);
