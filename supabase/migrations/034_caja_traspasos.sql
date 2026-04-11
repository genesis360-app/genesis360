-- ============================================================
-- Migration 034: Traspasos entre cajas + es_caja_fuerte
-- ============================================================

-- Campo es_caja_fuerte en cajas
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS es_caja_fuerte BOOLEAN DEFAULT FALSE;

-- Tabla de traspasos
CREATE TABLE caja_traspasos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_origen_id    UUID NOT NULL REFERENCES caja_sesiones(id),
  sesion_destino_id   UUID NOT NULL REFERENCES caja_sesiones(id),
  monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  concepto            TEXT,
  usuario_id          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE caja_traspasos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'caja_traspasos' AND policyname = 'traspasos_tenant'
  ) THEN
    CREATE POLICY "traspasos_tenant" ON caja_traspasos
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_traspasos_origen  ON caja_traspasos(sesion_origen_id);
CREATE INDEX IF NOT EXISTS idx_traspasos_destino ON caja_traspasos(sesion_destino_id);
CREATE INDEX IF NOT EXISTS idx_traspasos_tenant  ON caja_traspasos(tenant_id);
