-- 405 — El módulo GASTOS server-side: pagos a proveedor, gastos fijos, cuotas y cheques
--
-- 🛑 REGLA #0 / Tanda F, cierre definitivo. La mig 404 dejó estas tablas afuera a propósito porque
-- hacía falta una definición de negocio. GO la dio (2026-09-08):
--
--   > "¿Un cajero puede registrar un pago a proveedor? Sólo si por temas del custom role tiene
--   >  acceso al módulo de Gastos. Por default un cajero no tiene acceso a ese módulo; ahora si el
--   >  dueño le da permisos para acceder al mod de Gastos, entonces ahí sí."
--
-- Eso es EXACTAMENTE lo que `auth_puede_editar_modulo` ya resuelve, y por eso no hace falta ninguna
-- estructura nueva: la función mira **primero** el permiso explícito del rol custom
-- (`roles_custom.permisos ->> 'gastos'`) y solo cae al allowlist de roles fijos si no hay ninguno.
-- Un CAJERO al que el DUEÑO le habilitó Gastos entra por la primera rama; uno sin ese permiso, no.
--
-- Premisa verificada en el código antes de escribirla (no se asumió):
--   · `/gastos` está en las RUTAS RESTRINGIDAS del CAJERO (`13_rol_cajero.spec.ts`) → por default
--     no tiene acceso, tal cual dijo GO.
--   · `/gastos` está en las RUTAS PERMITIDAS del SUPERVISOR (`15_rol_supervisor.spec.ts`) y del
--     CONTADOR (`18_rol_contador.spec.ts`, y `CONTADOR_ALLOWED` en `AppLayout.tsx`).
--   · DEPÓSITO y RRHH: restringida (specs 17 y 16).
--   → allowlist de roles fijos para 'gastos': **SUPERVISOR + CONTADOR**.
--
-- ── Corrección de un supuesto MÍO de la mig 404 ──────────────────────────────────────────────
-- La 404 dejó el INSERT y el UPDATE de `cheques` abiertos a todo el tenant, con este argumento:
-- "un CAJERO crea cheques legítimamente al cobrar". **Eso era falso.** Verificado con grep sobre
-- `VentasPage.tsx`: el POS no escribe `cheques` en ningún camino (los únicos hits de "cheque" son la
-- palabra "chequear"). Los cheques se crean SOLO desde Gastos — `ChequesPanel` (que vive dentro de
-- `GastosPage`) y el alta de gasto pagado con cheque — más el RPC `registrar_pago_oc`, que es
-- SECURITY DEFINER y no pasa por RLS. Así que `cheques` también es módulo Gastos.
--
-- Se conserva el trigger de la 404 sobre el MONTO: crear o cobrar un cheque es del módulo, pero
-- cambiarle el monto a uno ya registrado sigue siendo supervisión (DUEÑO/ADMIN/SUPER_USUARIO/
-- SUPERVISOR). Un CONTADOR puede editar un cheque sin tocar el monto — el trigger compara
-- `IS DISTINCT FROM`, así que un payload con el mismo monto pasa.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) `auth_puede_editar_modulo` suma el módulo GASTOS
--    El resto queda EXACTAMENTE igual que en las migs 396 y 404.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_puede_editar_modulo(p_modulo text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rol  text;
  v_perm text;
BEGIN
  -- Sin sesión de usuario = service_role, Edge Functions, pg_cron. Esos caminos son de
  -- confianza y ya están gateados en su propia capa; si el guard los frenara romperíamos los
  -- workers de MELI/TN, el asistente de WhatsApp y los jobs. Verificado: todas las EF usan
  -- SUPABASE_SERVICE_ROLE_KEY.
  IF v_uid IS NULL THEN RETURN true; END IF;

  SELECT u.rol, rc.permisos ->> p_modulo
    INTO v_rol, v_perm
  FROM public.users u
  LEFT JOIN public.roles_custom rc ON rc.id = u.rol_custom_id AND rc.activo = true
  WHERE u.id = v_uid;

  IF v_rol IS NULL THEN RETURN false; END IF;

  -- Rol custom con permiso EXPLÍCITO para el módulo: manda ese permiso (incluye 'no_ver'/'ver',
  -- que son solo-lectura). 'supervisa' es superset de 'editar'.
  -- 👉 Esta es la rama por la que entra el CAJERO al que el DUEÑO le habilitó Gastos (mig 405).
  IF v_perm IS NOT NULL THEN RETURN v_perm IN ('editar','supervisa'); END IF;

  IF v_rol = 'VIEWER' THEN RETURN false; END IF;                       -- Lector: solo lectura
  IF v_rol IN ('DUEÑO','SUPER_USUARIO','ADMIN') THEN RETURN true; END IF;

  -- Roles fijos operativos: allowlist por módulo.
  RETURN CASE p_modulo
    -- Productos usa `modulo: 'inventario'` en el nav; el form (`ProductoFormPage.canEdit`) habilita
    -- la edición a DUEÑO/SUPERVISOR/SUPER_USUARIO. DEPÓSITO ve la página en solo-lectura.
    WHEN 'inventario'    THEN v_rol = 'SUPERVISOR'
    WHEN 'comercial'     THEN v_rol = 'SUPERVISOR'                      -- supervisorOnly (mig 404)
    -- Gastos: /gastos es ruta PERMITIDA para SUPERVISOR y CONTADOR, y RESTRINGIDA para CAJERO,
    -- DEPÓSITO y RRHH (specs 13/15/16/17/18 + CONTADOR_ALLOWED en AppLayout). El CAJERO con Gastos
    -- habilitado por rol custom entra arriba, por `v_perm` (mig 405).
    WHEN 'gastos'        THEN v_rol = ANY (ARRAY['SUPERVISOR','CONTADOR'])
    WHEN 'configuracion' THEN false                                     -- ownerOnly
    ELSE false
  END;
END $$;

COMMENT ON FUNCTION public.auth_puede_editar_modulo(text) IS
  'Espejo server-side de puedeEditarModulo (src/lib/permisosModulo.ts) + allowlists de navVisibility. '
  'Devuelve true sin sesión (service_role/EF/cron) a propósito. Migs 396, 404 y 405.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) Las tablas del módulo Gastos
--
--   · `proveedor_cc_movimientos` — la cuenta corriente del proveedor: lo que se le debe y lo que se
--     le pagó. Es la tabla que motivó la consulta a GO.
--   · `gastos_fijos` — plantilla de gastos recurrentes.
--   · `gasto_cuotas` — el plan de cuotas de un gasto (el gasto en sí ya tiene su propio guard de
--     UMBRAL por rol desde la mig 396; esto cierra la tabla hija).
--   · `cheques` — ver la corrección del supuesto de la 404, arriba.
--
-- La LECTURA queda abierta al tenant en las cuatro: son datos que los reportes y la ficha del
-- proveedor muestran, y ninguna guarda un secreto.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  policy_vieja text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proveedor_cc_movimientos','gastos_fijos','gasto_cuotas']
  LOOP
    FOR policy_vieja IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
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
        USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('gastos'))
        WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('gastos'))
    $f$, t || '_write_gastos', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) `cheques` — va aparte, por comando
--
-- ⚠ No puede resolverse con un `FOR ALL` + una policy de DELETE más estricta: en PostgreSQL las
-- policies PERMISIVAS se combinan con **OR**, así que un `FOR ALL` del módulo ya habilitaría el
-- borrado y la policy "solo gestión" no lo restaría. Por eso se escribe comando por comando.
-- Borrar un cheque en cartera hace desaparecer plata del circuito sin rastro: eso es gestión.
-- El trigger de la mig 404 sobre el MONTO se conserva tal cual.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cheques_select ON public.cheques;
DROP POLICY IF EXISTS cheques_insert ON public.cheques;
DROP POLICY IF EXISTS cheques_update ON public.cheques;
DROP POLICY IF EXISTS cheques_delete_gestion ON public.cheques;

CREATE POLICY cheques_select ON public.cheques
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY cheques_insert_gastos ON public.cheques
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id()
                         AND public.auth_puede_editar_modulo('gastos'));

CREATE POLICY cheques_update_gastos ON public.cheques
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('gastos'))
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo('gastos'));

CREATE POLICY cheques_delete_gestion ON public.cheques
  FOR DELETE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));

COMMIT;

COMMENT ON TABLE public.proveedor_cc_movimientos IS
  'Cuenta corriente del proveedor. Escritura gateada al módulo GASTOS (mig 405): por default la '
  'pueden mover SUPERVISOR y CONTADOR; un CAJERO solo si el DUEÑO le habilitó Gastos en su rol '
  'custom — regla definida por GO el 2026-09-08.';
