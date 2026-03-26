-- Migration 024: RRHH Phase 5 — Supervisor Self-Service
-- Función helper + políticas RLS para que SUPERVISOR acceda solo a su equipo

-- get_supervisor_team_ids(): devuelve IDs de empleados supervisados por el usuario actual
CREATE OR REPLACE FUNCTION get_supervisor_team_ids()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT e.id
  FROM empleados e
  WHERE e.supervisor_id = auth.uid()
    AND e.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND e.activo = true
$$;

-- Política: SUPERVISOR puede leer/escribir asistencia de su equipo
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rrhh_asistencia' AND policyname = 'rrhh_asistencia_supervisor'
  ) THEN
    CREATE POLICY "rrhh_asistencia_supervisor" ON rrhh_asistencia
      FOR ALL
      USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
      WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));
  END IF;
END $$;

-- Política: SUPERVISOR puede leer vacaciones de su equipo
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rrhh_vacaciones_solicitud' AND policyname = 'rrhh_vac_supervisor'
  ) THEN
    CREATE POLICY "rrhh_vac_supervisor" ON rrhh_vacaciones_solicitud
      FOR ALL
      USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
      WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));
  END IF;
END $$;

-- Política: SUPERVISOR puede leer saldos de vacaciones de su equipo
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rrhh_vacaciones_saldo' AND policyname = 'rrhh_vacsaldo_supervisor'
  ) THEN
    CREATE POLICY "rrhh_vacsaldo_supervisor" ON rrhh_vacaciones_saldo
      FOR ALL
      USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
      WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));
  END IF;
END $$;

-- Política: SUPERVISOR puede leer empleados de su equipo
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'empleados' AND policyname = 'empleados_supervisor'
  ) THEN
    CREATE POLICY "empleados_supervisor" ON empleados
      FOR SELECT
      USING (supervisor_id = auth.uid());
  END IF;
END $$;
