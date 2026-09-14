-- 415 — 🛑 El negocio se crea al CONFIRMAR el mail, no cuando el navegador aterriza
--
-- ── El bug, encontrado el 2026-09-14 grabando el video de onboarding ─────────────────────────
-- Hasta acá, crear el negocio era trabajo del NAVEGADOR: `provisionNegocio()` en `OnboardingPage`
-- corre después de que el link de confirmación redirige a la app. Si ese aterrizaje no ocurre, el
-- negocio no existe.
--
-- Y hay una forma muy común de que no ocurra: **el escáner de links del proveedor de correo**.
-- Gmail pre-carga las URLs de los mails (medido: 94 segundos después del envío). Supabase confirma
-- la cuenta y **consume el token, que es de un solo uso**, pero ningún navegador ejecutó la app.
-- Resultado: cuenta de auth confirmada y válida, **sin fila en `users` y sin `tenants`**.
--
-- La persona queda encerrada: el link le da `otp_expired`, el login autentica pero la app no
-- encuentra su fila, y registrarse de nuevo cae en el anti-enumeración de Supabase ("Revisá tu
-- email" para siempre). El mail queda quemado. Outlook Safe Links y los escáneres corporativos
-- hacen lo mismo.
--
-- ── El criterio ─────────────────────────────────────────────────────────────────────────────
-- Es el mismo que la REGLA #0 exige en lo fiscal: **guard server-side ADEMÁS de la UI**. Que el
-- alta de un negocio dependa de que un navegador llegue a una página es tan frágil como validar
-- un permiso solo en el frontend. Acá el negocio nace en la base, en el mismo momento en que la
-- cuenta queda confirmada, pase lo que pase del lado del cliente.
--
-- El frontend NO se saca: sigue siendo el camino normal (y el único para Google OAuth, que nace
-- confirmado). Los dos conviven — ver "Qué pasa si corren los dos" abajo.

-- ── La función ───────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER porque corre en el contexto del servicio de auth, que no pasa las policies de
-- `tenants`/`users`. Mismo criterio que los seeds de alta (mig 166).
CREATE OR REPLACE FUNCTION public.fn_crear_negocio_al_confirmar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_md     jsonb;
  v_tenant uuid;
BEGIN
  v_md := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);

  -- Solo las altas self-service traen `ob_nombre` + `ob_pais` en el metadata. Esto deja AFUERA, a
  -- propósito, a todo lo demás que también confirma un mail y NO debe tener negocio propio:
  -- usuarios invitados a un tenant existente (EF `invite-user`), agentes del panel de soporte
  -- (mig 221) y las cuentas del Portal de Proveedores (migs 387/390).
  IF v_md->>'ob_nombre' IS NULL OR v_md->>'ob_pais' IS NULL THEN
    RETURN NEW;
  END IF;

  -- El navegador llegó primero y ya lo creó: no duplicar.
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- `tenants` solo exige `nombre`; el resto de las columnas tiene default (incluidos
  -- `trial_ends_at`, `modo_operacion` y `moneda`). Los 5 triggers `AFTER INSERT ON tenants`
  -- siembran sucursal, caja, métodos de pago, categorías de gasto, canales y unidades.
  INSERT INTO public.tenants (
    nombre, tipo_comercio, pais, telefono,
    subscription_status, max_users, regla_inventario,
    terminos_aceptados_at, terminos_version, marketing_consent
  ) VALUES (
    v_md->>'ob_nombre',
    NULLIF(btrim(COALESCE(v_md->>'ob_tipo', '')), ''),
    v_md->>'ob_pais',
    NULLIF(btrim(COALESCE(v_md->>'ob_telefono', '')), ''),
    'trial', 2, 'Manual',
    now(),
    -- La versión de T&C que la persona aceptó viaja en el metadata desde el frontend. Si no vino
    -- (alta anterior a este cambio), queda NULL: inventar una versión sería falsear un
    -- consentimiento legal.
    NULLIF(btrim(COALESCE(v_md->>'ob_terminos_version', '')), ''),
    COALESCE((v_md->>'ob_marketing')::boolean, false)
  )
  RETURNING id INTO v_tenant;

  INSERT INTO public.users (id, tenant_id, rol, nombre_display, activo)
  VALUES (
    NEW.id, v_tenant, 'DUEÑO',
    COALESCE(NULLIF(btrim(COALESCE(v_md->>'full_name', '')), ''),
             NULLIF(btrim(COALESCE(v_md->>'name', '')), ''),
             NEW.email),
    true
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- 🛑 CRÍTICO: este trigger NO puede romper la confirmación del mail. Si algo falla acá y se
  -- propaga, la persona no puede ni siquiera confirmar su cuenta — un bug peor que el que esto
  -- arregla. Se avisa y se deja seguir: el camino del frontend sigue estando como red.
  RAISE WARNING 'fn_crear_negocio_al_confirmar falló para % (%): %', NEW.id, NEW.email, SQLERRM;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_crear_negocio_al_confirmar() IS
  'Crea el negocio al confirmarse el mail (mig 415), sin depender de que el navegador aterrice en '
  '/onboarding. Lo motivó el escáner de links de Gmail, que consume el token de confirmación de un '
  'solo uso y dejaba la cuenta confirmada SIN tenant, sin forma de recuperarse. Solo actúa sobre '
  'altas self-service (las únicas con ob_nombre+ob_pais); invitados, agentes y proveedores quedan '
  'afuera. Nunca hace fallar la confirmación: atrapa cualquier error y avisa.';

-- ── Los disparadores ─────────────────────────────────────────────────────────────────────────
-- Dos, porque la confirmación llega de dos formas distintas:
--   · UPDATE  → PROD, donde `mailer_autoconfirm` es false: el usuario nace sin confirmar y el mail
--               (o su escáner) lo confirma después.
--   · INSERT  → DEV, donde `mailer_autoconfirm` es true: el usuario nace ya confirmado. Tenerlo
--               hace que DEV se comporte como PROD y que esto se pueda probar sin adivinar.
DROP TRIGGER IF EXISTS trg_crear_negocio_al_confirmar ON auth.users;
CREATE TRIGGER trg_crear_negocio_al_confirmar
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.fn_crear_negocio_al_confirmar();

DROP TRIGGER IF EXISTS trg_crear_negocio_al_confirmar_ins ON auth.users;
CREATE TRIGGER trg_crear_negocio_al_confirmar_ins
  AFTER INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.fn_crear_negocio_al_confirmar();

-- ── Qué pasa si corren los dos (trigger y frontend) ──────────────────────────────────────────
-- El `EXISTS` de arriba cubre el caso normal. En la carrera exacta —el navegador aterriza en el
-- mismo instante— el trigger gana: `users.id` es PK, así que el INSERT del frontend falla con
-- violación de unicidad, y `provisionNegocio()` ya borra el tenant que había creado antes de
-- propagar el error. No quedan tenants huérfanos.
--
-- ── Lo que este trigger NO hace ──────────────────────────────────────────────────────────────
-- No manda el mail de bienvenida (eso lo dispara el frontend con la EF `send-email`). Si la
-- persona nunca aterriza, se crea el negocio pero no recibe ese mail. Es un detalle menor frente a
-- quedarse sin negocio, y evita meter `pg_net` en el camino de la confirmación.
