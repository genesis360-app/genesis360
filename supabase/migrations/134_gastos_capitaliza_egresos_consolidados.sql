-- Migration 134: capitalizacion de gastos en recursos + vista consolidada de egresos
-- Reglas de negocio Gastos · Fase 4 (v1.8.45)

-- ============================================================
-- 1) Gastos que capitalizan al valor del recurso
-- ============================================================
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS capitaliza_recurso BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN gastos.capitaliza_recurso IS 'Cuando es TRUE, el monto del gasto suma al valor patrimonial del recurso asociado (mejoras, ampliaciones). Sólo aplica si recurso_id IS NOT NULL.';

-- Coherencia: capitaliza_recurso solo si hay recurso_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'gastos_capitaliza_requires_recurso'
      AND table_name      = 'gastos'
  ) THEN
    ALTER TABLE gastos
      ADD CONSTRAINT gastos_capitaliza_requires_recurso
      CHECK (capitaliza_recurso = FALSE OR recurso_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gastos_recurso_capit
  ON gastos(recurso_id, capitaliza_recurso)
  WHERE recurso_id IS NOT NULL;

-- ============================================================
-- 2) Vista vw_egresos_consolidados: gastos + nomina pagada
-- ============================================================
-- Une egresos de Gastos (todos) + Sueldos pagados de RRHH (rrhh_salarios.pagado=true)
-- en un solo conjunto para reportes/dashboards/P&L.
-- SECURITY INVOKER: respeta las RLS de las tablas subyacentes.

DROP VIEW IF EXISTS vw_egresos_consolidados;

CREATE VIEW vw_egresos_consolidados
WITH (security_invoker = true)
AS
  SELECT
    g.id                                    AS id,
    'gasto'::TEXT                           AS fuente,
    g.tenant_id,
    g.fecha::DATE                           AS fecha,
    g.monto                                 AS monto,
    g.descripcion                           AS descripcion,
    g.categoria                             AS categoria,
    g.categoria_id                          AS categoria_id,
    g.sucursal_id                           AS sucursal_id,
    g.medio_pago                            AS medio_pago,
    g.usuario_id                            AS usuario_id,
    g.recurso_id                            AS recurso_id,
    NULL::UUID                              AS empleado_id,
    NULL::DATE                              AS periodo,
    g.created_at                            AS created_at
  FROM gastos g

  UNION ALL

  SELECT
    s.id                                    AS id,
    'rrhh_salario'::TEXT                    AS fuente,
    s.tenant_id,
    COALESCE(s.fecha_pago::DATE, s.periodo) AS fecha,
    s.neto                                  AS monto,
    ('Nómina ' || COALESCE(e.nombre, e.dni_rut, 'empleado') ||
       ' - ' || TO_CHAR(s.periodo, 'MM/YYYY')) AS descripcion,
    'Sueldos (RRHH)'::TEXT                  AS categoria,
    NULL::UUID                              AS categoria_id,
    NULL::UUID                              AS sucursal_id,
    s.medio_pago                            AS medio_pago,
    NULL::UUID                              AS usuario_id,
    NULL::UUID                              AS recurso_id,
    s.empleado_id                           AS empleado_id,
    s.periodo                               AS periodo,
    s.fecha_pago                            AS created_at
  FROM rrhh_salarios s
  LEFT JOIN empleados e ON e.id = s.empleado_id
  WHERE s.pagado = TRUE;

COMMENT ON VIEW vw_egresos_consolidados IS 'Vista unificada de egresos del negocio: gastos (todos) + sueldos pagados (rrhh_salarios.pagado=true). Respeta RLS de las tablas subyacentes via security_invoker.';
