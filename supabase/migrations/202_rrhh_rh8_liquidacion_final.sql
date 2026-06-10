-- Migration 202 — RRHH RH8: liquidación final (A2-c)
-- G1 reportes + G2 export son solo frontend. Esta migración persiste la liquidación final
-- del egreso (auditable + link al gasto generado). Todo aditivo / idempotente.

CREATE TABLE IF NOT EXISTS rrhh_liquidaciones_finales (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id            UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha_egreso           DATE,
  motivo_egreso          TEXT,
  antiguedad_anios       INT,
  mejor_sueldo           NUMERIC,
  indemnizacion          NUMERIC NOT NULL DEFAULT 0,
  sac_proporcional       NUMERIC NOT NULL DEFAULT 0,
  vacaciones_no_gozadas  NUMERIC NOT NULL DEFAULT 0,
  total                  NUMERIC NOT NULL DEFAULT 0,
  gasto_id               UUID REFERENCES gastos(id) ON DELETE SET NULL,
  notas                  TEXT,
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_liq_finales_emp ON rrhh_liquidaciones_finales(tenant_id, empleado_id);
ALTER TABLE rrhh_liquidaciones_finales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_liq_finales_tenant' AND tablename='rrhh_liquidaciones_finales') THEN
    CREATE POLICY "rrhh_liq_finales_tenant" ON rrhh_liquidaciones_finales FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
COMMENT ON TABLE rrhh_liquidaciones_finales IS 'RH8/A2-c: liquidación final del egreso (indemnización + SAC proporcional + vacaciones no gozadas).';
