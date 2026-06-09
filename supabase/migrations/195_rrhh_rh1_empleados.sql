-- Migration 195 — RRHH RH1: Empleados 2.0 (A1-A5)
-- A2 motivo de egreso · A3 tipo de contrato configurable (drop CHECK) · A4 datos bancarios.
-- A1 (obligatorios) = validación de form. A5 (user_id) ya existe (mig 151).
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) empleados — motivo de egreso (A2) + datos bancarios (A4)
-- ============================================================
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_egreso  TEXT;   -- A2: renuncia|despido_con_causa|despido_sin_causa|fin_contrato
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cbu            TEXT;    -- A4
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS alias_cbu      TEXT;    -- A4
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS banco          TEXT;    -- A4
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tipo_cuenta    TEXT;    -- A4 (caja_ahorro|cuenta_corriente)
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS titular_cuenta TEXT;    -- A4

COMMENT ON COLUMN empleados.motivo_egreso IS 'RH1/A2: motivo de la baja (renuncia/despido_con_causa/despido_sin_causa/fin_contrato).';

-- ============================================================
-- 2) tipo de contrato configurable (A3) — catálogo por tenant + drop CHECK rígida
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_tipos_contrato (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre                 TEXT NOT NULL,
  es_relacion_dependencia BOOLEAN NOT NULL DEFAULT TRUE,  -- dispara auto-aportes (B4)
  activo                 BOOLEAN NOT NULL DEFAULT TRUE,
  predefinido            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_rrhh_tipos_contrato_tenant ON rrhh_tipos_contrato(tenant_id);
ALTER TABLE rrhh_tipos_contrato ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_tipos_contrato_tenant' AND tablename='rrhh_tipos_contrato') THEN
    CREATE POLICY "rrhh_tipos_contrato_tenant" ON rrhh_tipos_contrato
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
COMMENT ON TABLE rrhh_tipos_contrato IS 'RH1/A3: catálogo configurable de tipos de contrato por tenant. es_relacion_dependencia dispara auto-aportes (RH2/B4).';

-- empleados.tipo_contrato pasa de CHECK rígida a texto libre validado por la app (apunta al catálogo).
ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_tipo_contrato_check;

-- Seed del catálogo base para tenants existentes (idempotente)
INSERT INTO rrhh_tipos_contrato (tenant_id, nombre, es_relacion_dependencia, predefinido)
SELECT t.id, v.nombre, v.rel_dep, TRUE
FROM tenants t
CROSS JOIN (VALUES
  ('Relación de dependencia', TRUE),
  ('Monotributista',          FALSE),
  ('Pasantía',                TRUE),
  ('Plazo fijo',              TRUE),
  ('Temporada',               TRUE)
) AS v(nombre, rel_dep)
WHERE NOT EXISTS (
  SELECT 1 FROM rrhh_tipos_contrato rtc WHERE rtc.tenant_id = t.id AND rtc.nombre = v.nombre
);
