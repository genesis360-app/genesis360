-- 410 — El panel de soporte puede buscar un cliente por el MAIL de su dueño
--
-- ── El problema (GO, 2026-09-12) ─────────────────────────────────────────────────────────────
--   > "en el panel interno (admin) no tengo como filtrar o saber quien es el dueño de un tenant y
--   >  su mail. Ej quería filtrar para saber si el mail genesis360.ar tenia un tenant y no tenía
--   >  forma."
--
-- La pantalla de Clientes solo busca por `tenants.nombre`. Pero un cliente que escribe a soporte
-- lo hace DESDE SU MAIL, y ese es justamente el dato con el que no se podía buscar. Peor: el mail
-- ni siquiera se mostraba, así que tampoco se lo podía leer de la lista.
--
-- ── Por qué hace falta una función y no alcanza con la Edge Function ─────────────────────────
-- Los mails viven en `auth.users`, un esquema que PostgREST NO expone. La EF podría recorrer
-- `auth.admin.listUsers()` y armar el índice en memoria, pero eso trae TODOS los usuarios de la
-- plataforma en páginas de 50 para poder filtrar uno — no escala y se rompe solo cuando crezca.
-- Con una función `SECURITY DEFINER` el filtro lo hace Postgres, donde están los índices.
--
-- ── 🛑 Quién puede ejecutarla ────────────────────────────────────────────────────────────────
-- Esto devuelve mails de TODOS los tenants: es exactamente el tipo de función que no puede quedar
-- al alcance de un usuario logueado de la app. Por eso se REVOCA de `public`/`anon`/`authenticated`
-- y se concede SOLO a `service_role`, que es la identidad con la que corre `admin-api` — y esa EF
-- ya valida agente activo + rol + audita antes de llamar a nada.
--
-- ⚠️ El REVOKE de `anon, authenticated` NO es redundante con el de `PUBLIC`: este proyecto tiene un
-- ALTER DEFAULT PRIVILEGES que le da EXECUTE directo a esos dos roles en toda función nueva de
-- `public` (verificado en `pg_default_acl`). Quitar esa línea "porque ya está el REVOKE de PUBLIC"
-- dejaría la función invocable por cualquier usuario logueado de la app. Es el mismo agujero que
-- tuvo que corregir la mig 272.

-- ── Resumen de cada negocio, con su dueño ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_tenants_overview(
  p_q     text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id                  uuid,
  nombre              text,
  created_at          timestamptz,
  subscription_status text,
  trial_ends_at       timestamptz,
  plan_tier           text,
  billing_mode        text,
  modo_operacion      text,
  pais                text,
  tipo_comercio       text,
  delete_scheduled_at timestamptz,
  dueno_nombre        text,
  dueno_email         text,
  usuarios            integer,
  ultimo_acceso       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  WITH q AS (SELECT NULLIF(btrim(p_q), '') AS term),
  duenos AS (
    -- Un negocio puede tener más de un DUEÑO; se toma el más antiguo (el que lo creó).
    SELECT DISTINCT ON (u.tenant_id)
           u.tenant_id, u.nombre_display, au.email
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.rol = 'DUEÑO'
    ORDER BY u.tenant_id, u.created_at
  ),
  agg AS (
    SELECT u.tenant_id,
           COUNT(*)::int              AS usuarios,
           MAX(au.last_sign_in_at)     AS ultimo_acceso
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    GROUP BY u.tenant_id
  )
  SELECT t.id, t.nombre, t.created_at, t.subscription_status, t.trial_ends_at,
         t.plan_tier, t.billing_mode, t.modo_operacion, t.pais, t.tipo_comercio,
         t.delete_scheduled_at,
         d.nombre_display, d.email,
         COALESCE(a.usuarios, 0), a.ultimo_acceso
  FROM public.tenants t
  LEFT JOIN duenos d ON d.tenant_id = t.id
  LEFT JOIN agg    a ON a.tenant_id = t.id
  CROSS JOIN q
  WHERE q.term IS NULL
     -- por nombre del negocio (lo único que había)
     OR t.nombre ILIKE '%' || q.term || '%'
     -- por el mail o el nombre del dueño
     OR d.email ILIKE '%' || q.term || '%'
     OR d.nombre_display ILIKE '%' || q.term || '%'
     -- por el mail de CUALQUIER usuario del negocio: el que escribe a soporte puede ser el
     -- cajero, no el dueño
     OR EXISTS (
          SELECT 1 FROM public.users u2
          JOIN auth.users au2 ON au2.id = u2.id
          WHERE u2.tenant_id = t.id AND au2.email ILIKE '%' || q.term || '%'
        )
     -- y por id, para cuando se pega un UUID salido de un log o de un ticket
     OR t.id::text = q.term
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;

-- ── Las cuentas de acceso de UN negocio ──────────────────────────────────────────────────────
-- Para la ficha del cliente: quién puede entrar, con qué rol y cuándo entró por última vez.
-- `es_agente` marca a los agentes del panel, que comparten el pool de `auth.users` (mig 221).
CREATE OR REPLACE FUNCTION public.fn_admin_tenant_cuentas(p_tenant_id uuid)
RETURNS TABLE (
  id             uuid,
  email          text,
  rol            text,
  nombre_display text,
  activo         boolean,
  created_at     timestamptz,
  ultimo_acceso  timestamptz,
  es_agente      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT u.id, au.email, u.rol, u.nombre_display, u.activo, u.created_at,
         au.last_sign_in_at,
         EXISTS (SELECT 1 FROM public.support_agents sa WHERE sa.id = u.id)
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.tenant_id = p_tenant_id
  ORDER BY (u.rol = 'DUEÑO') DESC, u.created_at;
$$;

-- 🛑 Solo `service_role`. Ver el bloque de arriba: estas funciones devuelven mails cross-tenant.
REVOKE ALL ON FUNCTION public.fn_admin_tenants_overview(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_tenants_overview(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_tenants_overview(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.fn_admin_tenant_cuentas(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_tenant_cuentas(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_tenant_cuentas(uuid) TO service_role;
