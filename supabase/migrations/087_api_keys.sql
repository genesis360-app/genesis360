-- Migration 087: API Keys para acceso externo por tenant
-- Permite a integraciones externas consultar datos de Genesis360 via EF data-api

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,   -- primeros 8 chars del plain text (ej: "g360_ab1") para display
  key_hash     TEXT NOT NULL,   -- SHA-256 de la clave completa, nunca se almacena el plain text
  permisos     TEXT[] DEFAULT ARRAY['read'],
  activo       BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'api_keys_tenant'
  ) THEN
    CREATE POLICY api_keys_tenant ON api_keys
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Solo OWNER/ADMIN puede gestionar keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'api_keys_owner_manage'
  ) THEN
    CREATE POLICY api_keys_owner_manage ON api_keys
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM users
          WHERE id = auth.uid() AND rol IN ('OWNER', 'ADMIN')
        )
      );
  END IF;
END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant     ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash   ON api_keys(key_hash);  -- lookup por hash en la EF
CREATE INDEX IF NOT EXISTS idx_api_keys_activo     ON api_keys(tenant_id, activo);

-- SET search_path
ALTER TABLE api_keys OWNER TO postgres;
