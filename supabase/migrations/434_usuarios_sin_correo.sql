-- 434 — Usuarios con nombre y contraseña, SIN correo
--
-- Pedido de GO: en un negocio chico los empleados no tienen mail propio, o tienen uno que no
-- revisan nunca. Hoy `invite-user` exige una dirección real (`inviteUserByEmail` manda un magic
-- link), así que el dueño terminaba inventando casillas o usando la suya.
--
-- La idea: el dueño crea al empleado con un NOMBRE DE USUARIO y una contraseña. Por dentro la app
-- arma una dirección que nunca recibe correo (`<usuario>.<codigo>@u.genesis360.pro`) y la usa como
-- identidad de Supabase Auth. El empleado nunca la ve ni la escribe.
--
-- Decisión de GO (2026-09-24): en la pantalla de ingreso el empleado escribe DOS cosas —el código
-- del negocio y su usuario— y no la dirección completa. Por eso el nombre de usuario solo tiene que
-- ser único DENTRO del negocio: cada dueño elige los que quiera sin que otro se los "reserve".
--
-- ⚠️ La dirección se compone SIEMPRE con el `codigo` que está en la base, nunca con uno que mande
-- el cliente: si no, cualquiera podría crearse un usuario dentro del negocio de otro.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · El código del negocio
--
--     Es la mitad pública de la identidad del empleado, así que es INMUTABLE: cambiarlo dejaría a
--     todos sus usuarios sin poder entrar (la dirección de Auth ya quedó fija con el código viejo).
--     Se genera una sola vez, del nombre del negocio, y no se edita desde la app.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS codigo text;

COMMENT ON COLUMN public.tenants.codigo IS
  'Código corto e INMUTABLE del negocio. Lo escribe el empleado al ingresar, junto con su usuario, '
  'y forma parte de la dirección interna de Auth (<usuario>.<codigo>@u.genesis360.pro). Cambiarlo '
  'dejaría afuera a todos los usuarios sin correo del negocio. Lo asigna el trigger trg_tenant_codigo.';

-- Normaliza un nombre de negocio a un código usable: sin tildes, sin ñ, sin espacios ni símbolos.
-- No usa `unaccent` a propósito (es una extensión, y acá alcanza con un translate explícito).
CREATE OR REPLACE FUNCTION public.fn_slug_codigo(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(
    left(
      regexp_replace(
        lower(translate(coalesce(p_texto, ''),
          'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
        '[^a-z0-9]', '', 'g'),
      14),
    '')
$function$;

-- Devuelve un código libre a partir del nombre. SECURITY DEFINER porque corre dentro del alta de
-- negocio: el trigger dispara ANTES de que exista la fila en `users`, así que sin esto el SELECT de
-- colisión sobre `tenants` lo filtraría RLS y devolvería siempre "libre" (mismo gotcha que la mig 166).
CREATE OR REPLACE FUNCTION public.fn_generar_codigo_tenant(p_nombre text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base   text := coalesce(public.fn_slug_codigo(p_nombre), 'negocio');
  v_cand   text;
  v_i      int := 1;
BEGIN
  -- El CHECK exige 3 caracteres como mínimo: "SA" o "3D" son nombres de negocio perfectamente
  -- posibles, y sin esto el INSERT moriría con un error de constraint en medio del alta.
  IF length(v_base) < 3 THEN v_base := v_base || 'neg'; END IF;

  v_cand := v_base;
  WHILE EXISTS (SELECT 1 FROM tenants WHERE codigo = v_cand) LOOP
    v_i := v_i + 1;
    IF v_i <= 999 THEN
      v_cand := left(v_base, 14) || v_i::text;                          -- 14 + 3 = 17, entra en el CHECK
    ELSE
      -- Tope: con un sufijo numérico creciente, el candidato n° 1.000.000 mediría 21 caracteres y
      -- violaría `tenants_codigo_formato`. Al azar mide siempre 6 (14 + 6 = 20, el máximo exacto).
      v_cand := left(v_base, 14) || substr(md5(random()::text), 1, 6);
    END IF;
  END LOOP;

  RETURN v_cand;
END;
$function$;

-- Backfill de los negocios que ya existen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, nombre FROM public.tenants WHERE codigo IS NULL ORDER BY created_at NULLS FIRST, id LOOP
    UPDATE public.tenants SET codigo = public.fn_generar_codigo_tenant(r.nombre) WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_codigo_formato;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_codigo_formato CHECK (codigo ~ '^[a-z0-9]{3,20}$') NOT VALID;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_codigo_formato;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_codigo_key ON public.tenants (codigo);

ALTER TABLE public.tenants ALTER COLUMN codigo SET NOT NULL;

-- Todo negocio nuevo nace con su código.
CREATE OR REPLACE FUNCTION public.fn_tenant_codigo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := public.fn_generar_codigo_tenant(NEW.nombre);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_codigo ON public.tenants;
CREATE TRIGGER trg_tenant_codigo
  BEFORE INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_tenant_codigo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · El nombre de usuario
--
--     NULL para todos los usuarios que entran con su correo real (los de hoy). Solo lo tienen los
--     creados por esta vía, y es lo que los distingue: son las ÚNICAS cuentas a las que el dueño
--     puede resetearles la contraseña, porque son las únicas sin casilla detrás.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS usuario text;

COMMENT ON COLUMN public.users.usuario IS
  'Nombre de usuario para ingresar sin correo (mig 434). NULL = la cuenta entra con su email real. '
  'Único dentro del negocio. Junto con tenants.codigo forma la dirección interna de Auth.';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_usuario_formato;
ALTER TABLE public.users
  ADD CONSTRAINT users_usuario_formato CHECK (usuario IS NULL OR usuario ~ '^[a-z0-9][a-z0-9_-]{2,29}$') NOT VALID;
ALTER TABLE public.users VALIDATE CONSTRAINT users_usuario_formato;

-- Único POR NEGOCIO, no global: es la decisión de GO de pedir el código del negocio al ingresar.
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_usuario_key
  ON public.users (tenant_id, usuario) WHERE usuario IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · El cambio de contraseña obligatorio del primer ingreso
--
--     Decisión de GO: la contraseña que pone el dueño es de un solo uso. Después del cambio, la
--     sabe únicamente el empleado — que es lo que hace que el log de actividad sea indiscutible.
--
--     🛑 La bandera NO se limpia desde el cliente. El EMPLEADO no puede: `users` no tiene policy de
--     UPDATE para uno mismo. Pero eso solo no alcanzaba —lo marcó la revisión de esta migración—
--     porque `users_update_owner` le da al DUEÑO un UPDATE sin restricción de columna sobre las
--     filas de su negocio: podía apagar la bandera con un PATCH directo a PostgREST, sin rotar
--     ninguna contraseña, y quedarse sabiendo la de su empleado para siempre. Justo la garantía que
--     esta bandera existe para dar.
--
--     Por eso va el guard de abajo, con el mismo patrón que la mig 247: la bandera solo BAJA desde
--     service_role, o sea desde la Edge Function `usuarios-sin-correo`, que cambia la contraseña y
--     la limpia en la misma llamada. Subirla a true sigue siendo libre (es "forzá un cambio").
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.debe_cambiar_password IS
  'true = la contraseña actual la puso el dueño y hay que cambiarla antes de usar la app (mig 434). '
  'La baja solamente la EF usuarios-sin-correo, junto con el cambio real de contraseña '
  '(lo fuerza trg_guard_debe_cambiar_password).';

CREATE OR REPLACE FUNCTION public.fn_guard_debe_cambiar_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Solo la transición true -> false, y solo fuera del servidor.
  IF NEW.debe_cambiar_password = false AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'La contraseña inicial se cambia desde la app: no alcanza con bajar la marca.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_debe_cambiar_password ON public.users;
CREATE TRIGGER trg_guard_debe_cambiar_password
  BEFORE UPDATE OF debe_cambiar_password ON public.users
  FOR EACH ROW
  WHEN (NEW.debe_cambiar_password IS DISTINCT FROM OLD.debe_cambiar_password)
  EXECUTE FUNCTION public.fn_guard_debe_cambiar_password();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · Nada de esto es un endpoint
--
--     Por defecto Postgres le da EXECUTE a PUBLIC sobre toda función nueva, y en Supabase `anon`
--     está adentro de PUBLIC: sin revocar, `fn_generar_codigo_tenant` —que es SECURITY DEFINER y
--     lee `tenants` salteándose RLS— quedaba disponible por RPC para cualquiera, sin sesión.
--     Mismo criterio que la mig 086b y la 433.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_slug_codigo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_generar_codigo_tenant(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tenant_codigo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_debe_cambiar_password() FROM PUBLIC, anon, authenticated;
