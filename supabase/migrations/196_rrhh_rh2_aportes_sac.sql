-- Migration 196 — RRHH RH2: Conceptos + aportes AR + SAC (B3/B4/B5)
-- B3 catálogo base por país + editable · B4 aportes configurables por empleado (% en concepto)
-- B5 SAC = mejor sueldo del semestre. Todo aditivo / idempotente.

-- ============================================================
-- 1) rrhh_conceptos — metadata para auto-cálculo (B3/B4)
-- ============================================================
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS pais         TEXT;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS predefinido  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS tipo_calculo TEXT NOT NULL DEFAULT 'fijo';   -- fijo|porcentaje|sobre_bruto
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS default_pct  NUMERIC;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS default_monto NUMERIC;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS es_aporte    BOOLEAN NOT NULL DEFAULT FALSE; -- toggleable por empleado (B4)

COMMENT ON COLUMN rrhh_conceptos.es_aporte IS 'RH2/B4: si true, es un aporte/retención que se prende/apaga por empleado (jubilación/OS/ley 19.032). El % vive acá (default_pct).';

-- ============================================================
-- 2) empleados — config de aportes por empleado + beneficios extra (B4)
-- ============================================================
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS config_aportes  JSONB NOT NULL DEFAULT '[]'::jsonb;  -- array de concepto_id activos
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS beneficios_extra JSONB NOT NULL DEFAULT '[]'::jsonb; -- [{nombre,tipo:'monto'|'porcentaje',valor}]

COMMENT ON COLUMN empleados.config_aportes IS 'RH2/B4: concepto_id de aportes activos para este empleado (checkbox). El % se edita en el concepto, no acá.';

-- ============================================================
-- 3) Seed catálogo base AR para tenants existentes (idempotente, por nombre)
-- ============================================================
INSERT INTO rrhh_conceptos (tenant_id, nombre, tipo, tipo_calculo, default_pct, es_aporte, predefinido, pais, activo)
SELECT t.id, v.nombre, v.tipo, v.tcalc, v.pct, v.aporte, TRUE, 'AR', TRUE
FROM tenants t
CROSS JOIN (VALUES
  ('Antigüedad',   'HABER',     'porcentaje', NULL::numeric, FALSE),
  ('Presentismo',  'HABER',     'porcentaje', NULL::numeric, FALSE),
  ('Jubilación',   'DESCUENTO', 'sobre_bruto', 11::numeric,  TRUE),
  ('Obra Social',  'DESCUENTO', 'sobre_bruto', 3::numeric,   TRUE),
  ('Ley 19.032',   'DESCUENTO', 'sobre_bruto', 3::numeric,   TRUE),
  ('Sindicato',    'DESCUENTO', 'sobre_bruto', NULL::numeric, FALSE)
) AS v(nombre, tipo, tcalc, pct, aporte)
WHERE NOT EXISTS (
  SELECT 1 FROM rrhh_conceptos rc WHERE rc.tenant_id = t.id AND rc.nombre = v.nombre
);

-- Marcar conceptos AR ya existentes (de seeds previos) como aporte si coinciden por nombre
UPDATE rrhh_conceptos SET es_aporte = TRUE, tipo_calculo = 'sobre_bruto',
  default_pct = CASE WHEN nombre = 'Jubilación' THEN 11 ELSE 3 END
WHERE nombre IN ('Jubilación', 'Obra Social', 'Ley 19.032') AND es_aporte = FALSE AND default_pct IS NULL;
