-- ============================================================
-- Migration 019: RRHH Phase 3A — Asistencia
-- Tabla: rrhh_asistencia
-- ============================================================

-- ─── rrhh_asistencia ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rrhh_asistencia (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  fecha         DATE NOT NULL,
  hora_entrada  TIME,
  hora_salida   TIME,
  estado        TEXT NOT NULL DEFAULT 'presente'
                CHECK (estado IN ('presente','ausente','tardanza','licencia')),
  motivo        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, empleado_id, fecha)
);
ALTER TABLE rrhh_asistencia ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_tenant   ON rrhh_asistencia(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_empleado ON rrhh_asistencia(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_fecha    ON rrhh_asistencia(tenant_id, fecha);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_asistencia' AND policyname='rrhh_asistencia_tenant') THEN
    CREATE POLICY "rrhh_asistencia_tenant" ON rrhh_asistencia
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── updated_at trigger ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_asistencia_updated_at' AND event_object_table = 'rrhh_asistencia'
  ) THEN
    CREATE TRIGGER trg_asistencia_updated_at
      BEFORE UPDATE ON rrhh_asistencia
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
