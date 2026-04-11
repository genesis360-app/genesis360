-- Migration 036: rrhh_feriados — feriados nacionales, provinciales y personalizados por tenant
CREATE TABLE IF NOT EXISTS rrhh_feriados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  fecha       DATE NOT NULL,
  tipo        TEXT DEFAULT 'nacional' CHECK (tipo IN ('nacional', 'provincial', 'personalizado', 'no_laborable')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_feriados ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'rrhh_feriados' AND policyname = 'feriados_tenant'
  ) THEN
    CREATE POLICY "feriados_tenant" ON rrhh_feriados
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_feriados_tenant_fecha ON rrhh_feriados(tenant_id, fecha);
