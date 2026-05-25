-- Migration 132: umbrales de gasto por sucursal + autorizaciones de gastos
-- Reglas de negocio Gastos · Fase 2 (v1.8.43)
-- Granular por rol: DUEÑO/ADMIN sin tope · SUPERVISOR hasta umbral_gasto_supervisor · CAJERO hasta umbral_gasto_cajero
-- Si el monto supera el umbral del rol → requiere autorización del rol superior.

-- ============================================================
-- 1) Umbrales por sucursal
-- ============================================================
ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS umbral_gasto_supervisor DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS umbral_gasto_cajero     DECIMAL(12,2);

COMMENT ON COLUMN sucursales.umbral_gasto_supervisor IS 'Monto máximo de gasto que un SUPERVISOR puede crear/editar/eliminar sin autorización del DUEÑO. NULL = sin restricción.';
COMMENT ON COLUMN sucursales.umbral_gasto_cajero     IS 'Monto máximo de gasto que un CAJERO puede crear/editar sin autorización del SUPERVISOR. NULL = todo requiere autorización.';

-- ============================================================
-- 2) Tabla autorizaciones_gasto
-- ============================================================
CREATE TABLE IF NOT EXISTS autorizaciones_gasto (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  gasto_id        UUID REFERENCES gastos(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('crear','editar','eliminar')),
  monto           DECIMAL(12,2),
  descripcion     TEXT,
  motivo          TEXT,
  payload         JSONB,
  solicitante_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  solicitante_rol TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),
  aprobador_id    UUID REFERENCES users(id),
  aprobador_rol   TEXT,
  resolved_at     TIMESTAMPTZ,
  motivo_rechazo  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autoriz_gasto_tenant_estado ON autorizaciones_gasto(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_autoriz_gasto_solicitante   ON autorizaciones_gasto(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_autoriz_gasto_gasto         ON autorizaciones_gasto(gasto_id) WHERE gasto_id IS NOT NULL;

ALTER TABLE autorizaciones_gasto ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='autoriz_gasto_tenant' AND tablename='autorizaciones_gasto') THEN
    CREATE POLICY "autoriz_gasto_tenant" ON autorizaciones_gasto FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE  autorizaciones_gasto IS 'Solicitudes de autorización para crear/editar/eliminar gastos que superan el umbral del solicitante.';
COMMENT ON COLUMN autorizaciones_gasto.tipo            IS 'crear | editar | eliminar';
COMMENT ON COLUMN autorizaciones_gasto.payload         IS 'JSONB con los datos del gasto pendiente de aplicar (descripcion, categoria, medio_pago, fecha, etc.)';
COMMENT ON COLUMN autorizaciones_gasto.solicitante_rol IS 'Rol del solicitante al momento de la solicitud (CAJERO | SUPERVISOR)';
COMMENT ON COLUMN autorizaciones_gasto.aprobador_rol   IS 'Rol del aprobador al momento de la resolución';

-- ============================================================
-- 3) Función helper: ¿se puede aprobar esta solicitud?
-- ============================================================
-- Regla de aprobación:
--   solicitante CAJERO     → aprueba SUPERVISOR, ADMIN o DUEÑO
--   solicitante SUPERVISOR → aprueba ADMIN o DUEÑO
CREATE OR REPLACE FUNCTION puede_aprobar_autorizacion_gasto(p_solicitante_rol TEXT, p_aprobador_rol TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_solicitante_rol = 'CAJERO'     AND p_aprobador_rol IN ('SUPERVISOR','ADMIN','DUEÑO','SUPER_USUARIO') THEN TRUE
    WHEN p_solicitante_rol = 'SUPERVISOR' AND p_aprobador_rol IN ('ADMIN','DUEÑO','SUPER_USUARIO') THEN TRUE
    ELSE FALSE
  END;
$$;
