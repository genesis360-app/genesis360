-- Migration 151: UNIQUE parcial sobre empleados.user_id por tenant
-- Garantiza que un usuario del sistema esté vinculado a un único empleado
-- dentro del mismo tenant. Requerido para que get_supervisor_team_ids()
-- (migration 147) mapee unívocamente auth.uid() → empleados.user_id.
--
-- Se usa índice UNIQUE parcial (WHERE user_id IS NOT NULL) para permitir
-- múltiples empleados sin user vinculado, que es el caso default.

CREATE UNIQUE INDEX IF NOT EXISTS empleados_tenant_user_unique
  ON empleados(tenant_id, user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON INDEX empleados_tenant_user_unique IS
  'ISS-RRHH-A5: un user solo puede estar vinculado a un empleado por tenant. Habilita Mi Equipo del SUPERVISOR (get_supervisor_team_ids).';
