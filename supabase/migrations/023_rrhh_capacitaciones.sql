-- Migration 023: RRHH Phase 4B — Capacitaciones y certificados

CREATE TABLE IF NOT EXISTS rrhh_capacitaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  empleado_id     UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  fecha_inicio    DATE,
  fecha_fin       DATE,
  horas           DECIMAL(6,2),
  proveedor       TEXT,
  estado          TEXT CHECK (estado IN ('planificada','en_curso','completada','cancelada')) DEFAULT 'planificada',
  resultado       TEXT,
  certificado_path TEXT,   -- path en bucket 'empleados'
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_capacitaciones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rrhh_capacitaciones' AND policyname = 'rrhh_capacitaciones_tenant'
  ) THEN
    CREATE POLICY "rrhh_capacitaciones_tenant" ON rrhh_capacitaciones
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrhh_cap_empleado ON rrhh_capacitaciones(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_cap_tenant   ON rrhh_capacitaciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_cap_estado   ON rrhh_capacitaciones(estado);
