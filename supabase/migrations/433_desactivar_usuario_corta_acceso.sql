-- 433 — "Desactivar" un usuario le saca el acceso DE VERDAD
--
-- 🛑 El agujero (encontrado el 2026-09-23 contestando una pregunta de GO sobre cómo conviene manejar
-- las cuentas de los empleados): dar de baja a alguien NO le quitaba nada. La cadena completa:
--
--   · El botón "Desactivar" de `UsuariosPage` escribe `users.activo = false` y nada más.
--   · `get_user_tenant_id()` era `SELECT tenant_id FROM users WHERE id = auth.uid()`, SIN mirar
--     `activo`. Y como esa función gobierna el `USING` de prácticamente todas las policies de RLS,
--     el usuario dado de baja seguía viendo y escribiendo todo lo de su rol.
--   · `users_select` tampoco filtraba, ni `loadUserData` en el frontend.
--   · `user.activo` no se consultaba en NINGÚN lado de la app.
--
-- Y "Desactivar" es la única acción que existe sobre un usuario: no hay eliminar. O sea que desde la
-- app no había forma de cortarle el acceso a un empleado que se fue.
--
-- ⚠️ `users.activo` es `boolean DEFAULT true` y **nullable**. Filtrar con `AND activo` a secas dejaría
-- afuera a cualquier fila con NULL. Se usa `coalesce(activo, true)`, el mismo criterio que ya aplica
-- `fn_soporte_ticket_detalle` — NULL significa "activo", como siempre significó.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · El corte de raíz: sin tenant no hay RLS que pase
--     Una sola función y queda cerrado para todas las tablas a la vez, del lado del servidor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM users WHERE id = auth.uid() AND coalesce(activo, true)
$function$;

-- Un ADMIN de plataforma dado de baja tampoco debería seguir entrando.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND rol = 'ADMIN' AND coalesce(activo, true)
  )
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Que nadie se deje afuera a sí mismo ni deje al negocio sin dueño
--
--     Antes de esta migración darse de baja solo era un error cosmético. Ahora es un candado sin
--     llave: el usuario pierde el acceso y —si era el único DUEÑO— no queda nadie adentro que pueda
--     reactivarlo. Se bloquea en la base, no en la UI.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_baja_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Solo interesa la transición activo -> inactivo.
  IF coalesce(NEW.activo, true) OR NOT coalesce(OLD.activo, true) THEN
    RETURN NEW;
  END IF;

  -- `auth.uid()` es NULL cuando corre con service_role (panel de plataforma, scripts): ahí no aplica.
  IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'No podés darte de baja a vos mismo. Pedíselo a otro DUEÑO.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.rol = 'DUEÑO' AND NOT EXISTS (
    SELECT 1 FROM users u
     WHERE u.tenant_id = OLD.tenant_id
       AND u.rol = 'DUEÑO'
       AND u.id <> OLD.id
       AND coalesce(u.activo, true)
  ) THEN
    RAISE EXCEPTION 'Es el único DUEÑO activo del negocio: nombrá otro antes de darlo de baja.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_baja_usuario ON public.users;
CREATE TRIGGER trg_guard_baja_usuario
  BEFORE UPDATE OF activo ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_baja_usuario();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Para que la app pueda explicar qué pasó
--
--     Sin esto, el usuario dado de baja entra y no puede leer NI SU PROPIA FILA (la policy
--     `users_select` ya no lo deja), así que el frontend lo interpretaría como "no tiene negocio" y
--     lo mandaría al onboarding — ofreciéndole crear un negocio nuevo con su misma identidad. Peor
--     que el bug original.
--
--     Devuelve información solo sobre UNO MISMO, así que no filtra nada de nadie.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_estado_usuario_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'sin_sesion'
    WHEN EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND coalesce(activo, true)) THEN 'activo'
    WHEN EXISTS (SELECT 1 FROM users WHERE id = auth.uid()) THEN 'inactivo'
    ELSE 'sin_usuario'
  END
$function$;

REVOKE ALL ON FUNCTION public.fn_estado_usuario_actual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_estado_usuario_actual() TO authenticated;
