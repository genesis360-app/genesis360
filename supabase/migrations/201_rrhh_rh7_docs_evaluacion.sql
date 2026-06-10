-- Migration 201 — RRHH RH7: documentos + capacitaciones + evaluación + portal/notif (E1-E4/F1-F4)
-- E1 catálogo de documentos obligatorios · E2 vencimiento · E3 capacitación obligatoria
-- F2 portal del empleado (config) · F3 notificaciones (config) · F4 evaluación de desempeño.
-- E4 (costo de capacitación) = NO (GO eligió A). Todo aditivo / idempotente.

-- ============================================================
-- 1) E1 — catálogo de documentos requeridos por tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_documentos_catalogo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  obligatorio BOOLEAN NOT NULL DEFAULT TRUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);
ALTER TABLE rrhh_documentos_catalogo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_doc_catalogo_tenant' AND tablename='rrhh_documentos_catalogo') THEN
    CREATE POLICY "rrhh_doc_catalogo_tenant" ON rrhh_documentos_catalogo FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 2) E2 — vencimiento de documentos · E3 capacitación obligatoria
-- ============================================================
ALTER TABLE rrhh_documentos    ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;  -- E2
ALTER TABLE rrhh_documentos    ADD COLUMN IF NOT EXISTS catalogo_id       UUID REFERENCES rrhh_documentos_catalogo(id) ON DELETE SET NULL; -- E1
ALTER TABLE rrhh_capacitaciones ADD COLUMN IF NOT EXISTS obligatoria      BOOLEAN NOT NULL DEFAULT FALSE; -- E3

-- ============================================================
-- 3) F4 — evaluación de desempeño (escala 1-10 + 360° opcional)
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_evaluaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  periodo      TEXT NOT NULL,                         -- YYYY-T1 / YYYY-S1 / texto libre
  tipo         TEXT NOT NULL DEFAULT 'supervisor',    -- auto|supervisor|par (360°)
  evaluador_id UUID REFERENCES users(id) ON DELETE SET NULL,
  puntaje      INT,                                   -- 1-10
  comentarios  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_evaluaciones_emp ON rrhh_evaluaciones(tenant_id, empleado_id);
ALTER TABLE rrhh_evaluaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_evaluaciones_tenant' AND tablename='rrhh_evaluaciones') THEN
    CREATE POLICY "rrhh_evaluaciones_tenant" ON rrhh_evaluaciones FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 4) tenants — portal del empleado (F2) + notificaciones (F3)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_portal_empleado    BOOLEAN NOT NULL DEFAULT FALSE; -- F2 (off por default)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_portal_capacidades JSONB NOT NULL DEFAULT '{"vacaciones":true,"recibos":true,"documentos":false,"firma":false}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_notif_config       JSONB NOT NULL DEFAULT '{"cumpleanos":true,"aniversario":true,"vacaciones_proximas":true,"doc_vencer":true,"contrato_vencer":true}'::jsonb; -- F3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_doc_alerta_dias    INT NOT NULL DEFAULT 30; -- E2 alerta N días antes

COMMENT ON TABLE rrhh_documentos_catalogo IS 'RH7/E1: catálogo de documentos requeridos por tenant (alerta si faltan).';
COMMENT ON TABLE rrhh_evaluaciones IS 'RH7/F4: evaluaciones de desempeño (escala 1-10, tipo auto/supervisor/par).';
