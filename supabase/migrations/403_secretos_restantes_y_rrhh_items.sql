-- 403 — Los secretos que la mig 400 no cubrió + el detalle de sueldos que la 401 dejó afuera
--
-- 🛑 REGLA #0 / Tanda F2. Después de la mig 402 repetí la auditoría sobre **todo el esquema**, no
-- sobre las tablas del hallazgo: de las 152 policies, **111 tablas no miran el rol en ninguna
-- cláusula**. La mayoría está bien así (catálogo, clientes, datos operativos que todos necesitan),
-- pero salieron dos huecos que son continuación directa de las migs 400 y 401.
--
-- Medido impersonando un CAJERO real (`SET LOCAL ROLE authenticated` + `request.jwt.claims`, dentro
-- de transacciones con ROLLBACK). El CAJERO ve **exactamente lo mismo** que el DUEÑO:
--
--   1) 🔴 **La mig 400 cerró Mercado Pago, Tienda Nube y WhatsApp — y dejó afuera tres**:
--      · `meli_credentials.access_token` + `refresh_token` (Mercado Libre) — 2 filas legibles en DEV.
--        Con ese token se opera la cuenta de ML del comercio desde afuera: publicaciones, preguntas,
--        órdenes. Es el mismo riesgo que el de Mercado Pago, en la misma pantalla.
--      · `modo_credentials.api_key` (MODO — medio de pago).
--      · `courier_credenciales.credenciales` (JSONB con usuario/clave/contrato de Andreani, OCA, etc.).
--      Las tres, además, con SELECT para **anon** — que no tiene ninguna razón para leer credenciales.
--
--   2) 🔴 **La mig 401 cerró `rrhh_salarios` y `empleados` — pero no el DETALLE**: `rrhh_salario_items`
--      (los conceptos de cada liquidación: básico, horas extra, descuentos, con su monto) y
--      `rrhh_anticipos` (adelantos y préstamos por empleado) seguían con RLS por tenant a secas. Un
--      CAJERO leía **26 filas** de `rrhh_salario_items` en DEV. Con la cabecera cerrada y el detalle
--      abierto, el sueldo se reconstruye sumando los items: la 401 quedaba a medias.
--
-- Alcance real hoy (medido en PROD antes de tocar): `meli_credentials`, `modo_credentials`,
-- `courier_credenciales`, `rrhh_salario_items` y `rrhh_anticipos` tienen **0 filas en PROD**. O sea
-- que hoy no se filtra nada en producción — pero el agujero es estructural y el primer cliente real
-- entra en ~2 semanas.
--
-- Riesgo verificado ANTES de aplicar:
--   • `meli_credentials`: la consulta de `ConfigPage` ya usa lista explícita SIN los tokens.
--     Impacto cero.
--   • `modo_credentials`: la consulta traía `api_key` pero **la UI nunca la muestra** (el form de
--     reconfigurar arranca con `api_key: ''` y exige tipearla de nuevo). Sale de la lista y listo.
--   • `courier_credenciales`: el panel SÍ precargaba el JSONB en el formulario → se pasa al patrón
--     de "secreto de solo escritura" (columna generada `credenciales_configuradas` + reingreso
--     completo al cambiar). Es el mismo patrón del `afipsdk_token` de la mig 402.
--   • Escritura de las 6 tablas de credenciales: solo se escriben desde `ConfigPage` /
--     `CourierCredencialesPanel`, y `/configuracion` es `ownerOnly` en `AppLayout.tsx` (DUEÑO+ADMIN).
--     Los OAuth callbacks (`meli-oauth-callback`, etc.) son Edge Functions con service_role.
--   • RRHH: `rrhh_salario_items` lo leen `RrhhPage` (rol RRHH) y `MiPortalPage` (el recibo de sueldo
--     del propio empleado) → misma regla de dos ramas de la mig 401. `rrhh_anticipos` solo lo lee
--     `RrhhPage`, pero se le pone la misma regla por coherencia.
--
-- ⚠ Lo que NO se puede verificar con datos: en DEV hay **0 empleados con `user_id`**, así que la rama
-- "cada empleado ve lo suyo" no tiene fixture — igual que en la mig 401. Queda anotado: para probarla
-- de verdad hace falta vincular un empleado a un usuario.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Mercado Libre — los tokens dejan de ser legibles (lo que la mig 400 hizo con MP/TN/WhatsApp)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.meli_credentials FROM authenticated, anon;
GRANT SELECT (id, tenant_id, sucursal_id, seller_id, seller_nickname, seller_email,
              expires_at, conectado, created_at, updated_at)
  ON public.meli_credentials TO authenticated;

COMMENT ON COLUMN public.meli_credentials.access_token IS
  'SECRETO. Sin SELECT para authenticated/anon (mig 403) — solo service_role. No agregarlo a ninguna '
  'consulta del frontend; con `select(''*'')` PostgREST expande a todas las columnas y da 403.';
COMMENT ON COLUMN public.meli_credentials.refresh_token IS
  'SECRETO. Sin SELECT para authenticated/anon (mig 403) — solo service_role.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) MODO — la API key deja de viajar al browser
--    (la traía la consulta de ConfigPage, pero la UI nunca la mostró: el form exige retipearla)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.modo_credentials FROM authenticated, anon;
GRANT SELECT (id, tenant_id, merchant_id, ambiente, conectado, conectado_at, created_at, updated_at)
  ON public.modo_credentials TO authenticated;

COMMENT ON COLUMN public.modo_credentials.api_key IS
  'SECRETO. Sin SELECT para authenticated/anon (mig 403) — solo service_role (modo-crear-pago). '
  'Para saber si MODO está configurado, mirar `conectado`.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Couriers — el JSONB de credenciales (usuario/clave/contrato de Andreani, OCA, …)
--
-- Acá el panel SÍ precargaba el secreto en el formulario, así que hace falta el mismo reemplazo que
-- en la mig 402: una columna GENERADA con el booleano "¿hay credenciales cargadas?" para que la
-- pantalla siga pudiendo decir "Configurado" sin recibir el secreto.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.courier_credenciales
  ADD COLUMN IF NOT EXISTS credenciales_configuradas boolean
  GENERATED ALWAYS AS (credenciales IS NOT NULL AND credenciales <> '{}'::jsonb) STORED;

REVOKE SELECT ON public.courier_credenciales FROM authenticated, anon;
GRANT SELECT (id, tenant_id, courier, activo, credenciales_configuradas, created_at, updated_at)
  ON public.courier_credenciales TO authenticated;

COMMENT ON COLUMN public.courier_credenciales.credenciales IS
  'SECRETO de solo-escritura (usuario/clave/contrato del courier). Sin SELECT para authenticated/anon '
  '(mig 403) — solo service_role (courier-api). Para saber si hay credenciales cargadas, leer '
  'credenciales_configuradas. Al cambiarlas hay que reingresarlas COMPLETAS: el browser no puede '
  'leer las guardadas para hacer un merge parcial.';
COMMENT ON COLUMN public.courier_credenciales.credenciales_configuradas IS
  '¿Hay credenciales cargadas para este courier? Columna generada, legible por el frontend (mig 403).';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Las credenciales de integración tampoco las ESCRIBE cualquiera
--
-- La mig 400 cerró la LECTURA de MP/TN/WhatsApp pero dejó la escritura abierta: con la policy por
-- tenant a secas, un CAJERO podía desconectar las integraciones del comercio o pisar un token.
-- `/configuracion` es `ownerOnly` en el frontend → la base pasa a sostener lo mismo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  policy_vieja text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mercadopago_credentials','tiendanube_credentials','whatsapp_credentials',
                           'meli_credentials','modo_credentials','courier_credenciales']
  LOOP
    -- Las policies existentes se llaman distinto en cada tabla (`<tabla>_tenant`, `cred_tenant`, …):
    -- se dropean por catálogo en vez de por nombre adivinado.
    FOR policy_vieja IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_vieja, t);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT USING (tenant_id = public.get_user_tenant_id())
    $f$, t || '_select', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL
        USING (tenant_id = public.get_user_tenant_id()
               AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
        WITH CHECK (tenant_id = public.get_user_tenant_id()
               AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
    $f$, t || '_write_gestion', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) RRHH — el DETALLE de la liquidación, que la mig 401 dejó afuera
--
-- Misma regla de dos ramas que `rrhh_salarios`: administra RRHH → todo · el empleado → lo suyo.
-- `rrhh_salario_items` no tiene `empleado_id`, así que la rama del empleado va por su `salario_id`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rrhh_salario_items_tenant ON public.rrhh_salario_items;

CREATE POLICY rrhh_salario_items_select ON public.rrhh_salario_items
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_administra_rrhh()
      OR salario_id IN (
        SELECT s.id FROM public.rrhh_salarios s
         WHERE s.empleado_id IN (
           SELECT e.id FROM public.empleados e WHERE e.user_id = (SELECT auth.uid())
         )
      )
    )
  );

CREATE POLICY rrhh_salario_items_write ON public.rrhh_salario_items
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh())
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh());

DROP POLICY IF EXISTS rrhh_anticipos_tenant ON public.rrhh_anticipos;

CREATE POLICY rrhh_anticipos_select ON public.rrhh_anticipos
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_administra_rrhh()
      OR empleado_id IN (SELECT e.id FROM public.empleados e WHERE e.user_id = (SELECT auth.uid()))
    )
  );

CREATE POLICY rrhh_anticipos_write ON public.rrhh_anticipos
  FOR ALL
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh())
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_administra_rrhh());

COMMIT;
