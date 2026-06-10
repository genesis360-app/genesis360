-- Migration 199 — RRHH RH4: Frecuencia de liquidación + anticipos (B1/B10)
-- B1 frecuencia configurable por empleado (prorratea el básico) · B10 anticipo simple
-- con descuento automático en la próxima liquidación. Todo aditivo / idempotente.

-- ============================================================
-- 1) empleados — frecuencia de liquidación (B1)
-- ============================================================
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS frecuencia_liquidacion TEXT NOT NULL DEFAULT 'mensual'; -- mensual|quincenal|semanal|personalizado
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS frecuencia_dias        INT;  -- para 'personalizado' (cada X días)

COMMENT ON COLUMN empleados.frecuencia_liquidacion IS 'RH4/B1: frecuencia de liquidación; prorratea el básico (mensual=1, quincenal=1/2, semanal=1/4, personalizado=dias/30).';

-- ============================================================
-- 2) rrhh_anticipos (B10) — anticipo simple con descuento en la próxima liquidación
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_anticipos (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id             UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  monto                   NUMERIC NOT NULL DEFAULT 0,
  fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo                  TEXT,
  gasto_id                UUID REFERENCES gastos(id) ON DELETE SET NULL,        -- egreso generado en Gastos
  descontado_en_salario_id UUID REFERENCES rrhh_salarios(id) ON DELETE SET NULL, -- liquidación donde se descontó
  saldado                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rrhh_anticipos_emp ON rrhh_anticipos(tenant_id, empleado_id, saldado);
ALTER TABLE rrhh_anticipos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='rrhh_anticipos_tenant' AND tablename='rrhh_anticipos') THEN
    CREATE POLICY "rrhh_anticipos_tenant" ON rrhh_anticipos FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
COMMENT ON TABLE rrhh_anticipos IS 'RH4/B10: anticipos a empleados; se descuentan automáticamente en la próxima liquidación.';

-- ============================================================
-- 3) Categoría de gasto "Adelantos al personal" (B10) — idempotente
-- ============================================================
INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden)
SELECT t.id, 'Adelantos al personal', FALSE, TRUE, 17
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM categorias_gasto cg WHERE cg.tenant_id = t.id AND cg.nombre = 'Adelantos al personal'
);
