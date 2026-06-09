-- Migration 198 — RRHH RH6: Asistencia 2.0 (D1-D6)
-- D1 fichado (clock-in/out + QR) · D2 horario por empleado · D3 tardanza config
-- D4 licencias subdivididas + comprobante · D5 horas extra · D6 feriados reglas de pago.
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) rrhh_fichadas (D1) — clock-in / clock-out
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_fichadas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen      TEXT NOT NULL DEFAULT 'manual',  -- manual|celular|qr
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_fichadas_emp ON rrhh_fichadas(tenant_id, empleado_id, ts);
ALTER TABLE rrhh_fichadas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_fichadas_tenant' AND tablename='rrhh_fichadas') THEN
    CREATE POLICY "rrhh_fichadas_tenant" ON rrhh_fichadas FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 2) empleados — horario de trabajo (D2)
-- ============================================================
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS horario_entrada TIME;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS horario_salida  TIME;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS dias_laborales  JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb; -- 0=dom..6=sab

-- ============================================================
-- 3) rrhh_asistencia — licencias subdivididas + comprobante (D4)
-- ============================================================
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS tipo_licencia   TEXT;  -- medica|paga|no_paga|paternidad|maternidad|familiar|examen
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS comprobante_url TEXT;
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS minutos_tarde   INT;   -- D3

-- ============================================================
-- 4) rrhh_horas_extra (D5)
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_horas_extra (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL,
  horas         NUMERIC NOT NULL DEFAULT 0,
  multiplicador INT NOT NULL DEFAULT 50,  -- 50 = 50%, 100 = 100%
  aprobada      BOOLEAN NOT NULL DEFAULT FALSE,
  aprobada_por  UUID REFERENCES users(id) ON DELETE SET NULL,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_horas_extra_emp ON rrhh_horas_extra(tenant_id, empleado_id, fecha);
ALTER TABLE rrhh_horas_extra ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_horas_extra_tenant' AND tablename='rrhh_horas_extra') THEN
    CREATE POLICY "rrhh_horas_extra_tenant" ON rrhh_horas_extra FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 5) rrhh_feriados — regla de pago (D6)
-- ============================================================
ALTER TABLE rrhh_feriados ADD COLUMN IF NOT EXISTS regla_pago TEXT NOT NULL DEFAULT 'doble'; -- simple|doble|triple

-- ============================================================
-- 6) tenants — config tardanza (D3) + horas extra (D5)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_tardanza_modo            TEXT NOT NULL DEFAULT 'registrar'; -- registrar|proporcional|umbral
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_tardanza_tolerancia_min  INT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_horas_extra_requiere_aprobacion BOOLEAN NOT NULL DEFAULT TRUE; -- D5
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_horas_mes_base           INT NOT NULL DEFAULT 200; -- para sueldo/hora

COMMENT ON TABLE rrhh_fichadas IS 'RH6/D1: fichadas clock-in/out (manual/celular/qr).';
COMMENT ON TABLE rrhh_horas_extra IS 'RH6/D5: horas extra con multiplicador (50/100) + aprobación.';
