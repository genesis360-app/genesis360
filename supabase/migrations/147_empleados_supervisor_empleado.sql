-- Migration 147: el supervisor de un empleado es OTRO EMPLEADO, no un user (ISS-185)
-- Antes: empleados.supervisor_id → users(id). El árbol organizacional dependía de
-- qué empleados tenían usuario del sistema. Ahora el organigrama se arma 100% con
-- empleados de RRHH (tengan o no login). El self-service del SUPERVISOR se resuelve
-- mapeando auth.uid() → empleados.user_id → supervisor_id.

-- 1) Nulear supervisor_id viejos (apuntan a users; no hay empleados.user_id poblado
--    para migrarlos, así que se reasignan manualmente desde la nueva UI).
UPDATE empleados SET supervisor_id = NULL
WHERE supervisor_id IS NOT NULL
  AND supervisor_id NOT IN (SELECT id FROM empleados);

-- 2) Reapuntar la FK de users(id) → empleados(id)
ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_supervisor_id_fkey;
ALTER TABLE empleados
  ADD CONSTRAINT empleados_supervisor_id_fkey
  FOREIGN KEY (supervisor_id) REFERENCES empleados(id) ON DELETE SET NULL;

COMMENT ON COLUMN empleados.supervisor_id IS 'Empleado que supervisa a este (FK a empleados.id). El organigrama se arma con empleados de RRHH, no con users del sistema (ISS-185).';

-- 3) Self-service del supervisor: su equipo son los empleados cuyo supervisor_id
--    coincide con el empleado vinculado a su user (empleados.user_id = auth.uid()).
CREATE OR REPLACE FUNCTION public.get_supervisor_team_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id
  FROM empleados e
  WHERE e.supervisor_id IN (
          SELECT sup.id FROM empleados sup
          WHERE sup.user_id = auth.uid()
            AND sup.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        )
    AND e.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND e.activo = true
$function$;

COMMENT ON FUNCTION public.get_supervisor_team_ids() IS 'IDs de empleados supervisados por el usuario actual. Mapea auth.uid() → empleados.user_id → supervisor_id (ISS-185). Requiere que el supervisor esté vinculado a un empleado (empleados.user_id).';
