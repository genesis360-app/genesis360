-- ============================================================
-- Migration 018: RRHH Phase 2B — Vacaciones
-- Tablas: rrhh_vacaciones_solicitud · rrhh_vacaciones_saldo
-- Funciones: calcular_dias_habiles · aprobar_vacacion · rechazar_vacacion
-- ============================================================

-- ─── rrhh_vacaciones_solicitud ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rrhh_vacaciones_solicitud (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  desde         DATE NOT NULL,
  hasta         DATE NOT NULL,
  dias_habiles  INT NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','aprobada','rechazada')),
  notas         TEXT,
  aprobado_por  UUID REFERENCES users(id),
  aprobado_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_vacaciones_solicitud ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_tenant   ON rrhh_vacaciones_solicitud(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_empleado ON rrhh_vacaciones_solicitud(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_estado   ON rrhh_vacaciones_solicitud(tenant_id, estado);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_vacaciones_solicitud' AND policyname='rrhh_vac_sol_tenant') THEN
    CREATE POLICY "rrhh_vac_sol_tenant" ON rrhh_vacaciones_solicitud
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── rrhh_vacaciones_saldo ────────────────────────────────────────────────────
-- Saldo de vacaciones por empleado × año
CREATE TABLE IF NOT EXISTS rrhh_vacaciones_saldo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id        UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  anio               INT NOT NULL,
  dias_totales       INT NOT NULL DEFAULT 0,   -- días asignados este año
  dias_usados        INT NOT NULL DEFAULT 0,   -- días consumidos (aprobados)
  remanente_anterior INT NOT NULL DEFAULT 0,   -- días traídos del año anterior
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, empleado_id, anio)
);
ALTER TABLE rrhh_vacaciones_saldo ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sal_tenant   ON rrhh_vacaciones_saldo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sal_empleado ON rrhh_vacaciones_saldo(empleado_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_vacaciones_saldo' AND policyname='rrhh_vac_sal_tenant') THEN
    CREATE POLICY "rrhh_vac_sal_tenant" ON rrhh_vacaciones_saldo
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── updated_at triggers ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_vac_sol_updated_at' AND event_object_table = 'rrhh_vacaciones_solicitud'
  ) THEN
    CREATE TRIGGER trg_vac_sol_updated_at
      BEFORE UPDATE ON rrhh_vacaciones_solicitud
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_vac_sal_updated_at' AND event_object_table = 'rrhh_vacaciones_saldo'
  ) THEN
    CREATE TRIGGER trg_vac_sal_updated_at
      BEFORE UPDATE ON rrhh_vacaciones_saldo
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ─── calcular_dias_habiles (excluye sábado y domingo) ─────────────────────────
CREATE OR REPLACE FUNCTION calcular_dias_habiles(p_desde DATE, p_hasta DATE)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::INT
  FROM generate_series(p_desde, p_hasta, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);  -- 0=domingo, 6=sábado
$$;

-- ─── aprobar_vacacion ─────────────────────────────────────────────────────────
-- Aprueba una solicitud y descuenta del saldo anual (crea saldo si no existe).
CREATE OR REPLACE FUNCTION aprobar_vacacion(
  p_solicitud_id UUID,
  p_user_id      UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sol rrhh_vacaciones_solicitud;
  v_anio INT;
BEGIN
  SELECT * INTO v_sol FROM rrhh_vacaciones_solicitud WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF v_sol.estado != 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada';
  END IF;

  v_anio := EXTRACT(YEAR FROM v_sol.desde)::INT;

  -- Upsert saldo: incrementar dias_usados
  INSERT INTO rrhh_vacaciones_saldo (tenant_id, empleado_id, anio, dias_totales, dias_usados, remanente_anterior)
  VALUES (v_sol.tenant_id, v_sol.empleado_id, v_anio, 0, v_sol.dias_habiles, 0)
  ON CONFLICT (tenant_id, empleado_id, anio) DO UPDATE
    SET dias_usados = rrhh_vacaciones_saldo.dias_usados + v_sol.dias_habiles,
        updated_at  = NOW();

  -- Marcar como aprobada
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'aprobada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id;
END;
$$;

-- ─── rechazar_vacacion ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rechazar_vacacion(
  p_solicitud_id UUID,
  p_user_id      UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'rechazada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id AND estado = 'pendiente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada o ya procesada';
  END IF;
END;
$$;
