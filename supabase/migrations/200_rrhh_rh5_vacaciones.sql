-- Migration 200 — RRHH RH5: Vacaciones 2.0 (C1-C7)
-- C1 días por antigüedad (LCT) · C2 aprobación configurable por rol · C3 plazo de aviso
-- C4 solapamiento · C5 partición · C6 remanente auto + límite. Todo aditivo / idempotente.

-- ============================================================
-- 1) rrhh_vacaciones_solicitud — estado 'preaprobada' (C2)
-- ============================================================
ALTER TABLE rrhh_vacaciones_solicitud DROP CONSTRAINT IF EXISTS rrhh_vacaciones_solicitud_estado_check;
-- Validación de estado pasa a la app (pendiente|preaprobada|aprobada|rechazada).
ALTER TABLE rrhh_vacaciones_solicitud ADD COLUMN IF NOT EXISTS preaprobado_por UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE rrhh_vacaciones_solicitud ADD COLUMN IF NOT EXISTS preaprobado_at  TIMESTAMPTZ;

-- ============================================================
-- 2) tenants — config de vacaciones (C2/C3/C5/C6)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_flujo        JSONB NOT NULL DEFAULT '{"supervisor":"preaprueba","rrhh":"aprueba"}'::jsonb; -- C2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_aviso        JSONB NOT NULL DEFAULT '{"modo":"alerta","dias":30}'::jsonb;  -- C3 (sin|fijo|alerta) + días
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_remanente_max INT NOT NULL DEFAULT 0;  -- C6 (0 = sin límite)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_min_bloque    INT NOT NULL DEFAULT 0;  -- C5 (0 = sin mínimo)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_max_bloques   INT NOT NULL DEFAULT 0;  -- C5 (0 = sin máximo)

COMMENT ON COLUMN tenants.rrhh_vacaciones_flujo IS 'RH5/C2: flujo de aprobación por rol {supervisor,rrhh} ∈ preaprueba|aprueba|ninguno.';
COMMENT ON COLUMN tenants.rrhh_vacaciones_aviso IS 'RH5/C3: plazo mínimo de aviso {modo: sin|fijo|alerta, dias}.';
