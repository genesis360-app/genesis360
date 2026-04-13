-- Migration 045: Métodos de pago configurables por tenant
-- Permite definir colores y estado activo para cada método de pago.
-- Los colores son usados en el dashboard (MixCajaChart).

CREATE TABLE IF NOT EXISTS metodos_pago (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6b7280',
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  es_sistema  BOOLEAN NOT NULL DEFAULT FALSE,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, nombre)
);

ALTER TABLE metodos_pago ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'metodos_pago' AND policyname = 'metodos_pago_tenant'
  ) THEN
    CREATE POLICY metodos_pago_tenant ON metodos_pago
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_metodos_pago_tenant ON metodos_pago(tenant_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_metodos_pago_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_metodos_pago_updated_at ON metodos_pago;
CREATE TRIGGER trg_metodos_pago_updated_at
  BEFORE UPDATE ON metodos_pago
  FOR EACH ROW EXECUTE FUNCTION update_metodos_pago_updated_at();
