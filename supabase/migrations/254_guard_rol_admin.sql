-- Migration 254 — REGLA #0 (aislamiento multi-tenant): bloquear escalada a rol ADMIN.
--
-- Hallazgo: 'ADMIN' es el rol de STAFF de Genesis360 (is_admin() → los policies
-- tenants_select/tenants_update dan acceso a TODOS los tenants). La UI de un tenant no
-- ofrece ese rol, PERO:
--   • invite-user (EF) usaba el `rol` del request sin whitelist (arreglado en el EF), y
--   • UsuariosPage.updateRol hace un UPDATE directo `users.set rol` → un DUEÑO podía
--     PATCHear PostgREST con {rol:'ADMIN'} y escalar a admin de plataforma (ver todos
--     los clientes). Ruptura de aislamiento multi-tenant.
--
-- Guard server-side (defensa en profundidad): trigger que RECHAZA setear rol='ADMIN'
-- cuando el que escribe es un usuario JWT que NO es ya admin. Permite:
--   • service_role / SQL directo (auth.uid() IS NULL) → alta de staff por GO / EFs,
--   • un ADMIN existente (is_admin()) → gestión legítima de staff.
-- Bloquea: cualquier DUEÑO/usuario de un tenant intentando asignar ADMIN.

CREATE OR REPLACE FUNCTION public.fn_guard_rol_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rol = 'ADMIN'
     AND auth.uid() IS NOT NULL       -- hay un usuario autenticado (no service_role/SQL)
     AND NOT public.is_admin()        -- y NO es ya staff admin
  THEN
    RAISE EXCEPTION 'No autorizado a asignar el rol ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- BEFORE INSERT OR UPDATE OF rol → en UPDATE dispara solo si se toca `rol`.
DROP TRIGGER IF EXISTS trg_guard_rol_admin ON public.users;
CREATE TRIGGER trg_guard_rol_admin
  BEFORE INSERT OR UPDATE OF rol ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_rol_admin();
