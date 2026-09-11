-- 396 — Guards de rol server-side (Tanda F, huecos F1-h2 a h6)
--
-- CONTEXTO. La Tanda F midió con sondas REST reales que de las 152 policies del esquema **solo 14
-- miran el rol**: `productos`, `gastos`, `metodos_pago` y `roles_custom` filtraban por tenant/sucursal
-- y nada más. Con un token válido de CUALQUIER rol se podía, por REST directo, cambiar precios de
-- venta, editar el monto de un gasto, dar de alta productos y tocar los medios de pago — todo lo que
-- la UI esconde. Es exactamente la obligación #3 de la REGLA #0: guards server-side ADEMÁS de la UI.
--
-- POR QUÉ TRIGGERS Y NO RLS A SECAS (esto es lo delicado, y por lo que no se hizo antes):
-- un "CAJERO no escribe `productos`" **rompe ventas legítimas** — `VentasPage` actualiza
-- `productos.stock_actual` DESDE EL CLIENTE en devoluciones y anulaciones. Por eso el guard de
-- productos mira **solo las columnas de precio** y deja pasar el resto. Mismo criterio en gastos: el
-- CAJERO edita gastos legítimamente por debajo de su umbral, así que se enforcea el UMBRAL, no el rol.
--
-- ORDEN DELIBERADO: `roles_custom` se cierra PRIMERO. El helper confía en `roles_custom.permisos`, y
-- esa tabla era escribible por cualquier usuario del tenant → un usuario con rol custom podía
-- **auto-otorgarse** 'editar' y saltear todos los guards de abajo. Un guard que confía en un dato que
-- el atacante controla no es un guard.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0) F1-h6 — `roles_custom`: definir permisos es administración, no operación.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS roles_custom_tenant ON public.roles_custom;

CREATE POLICY roles_custom_select ON public.roles_custom
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY roles_custom_write_gestion ON public.roles_custom
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Helper: ¿el usuario de la sesión puede EDITAR este módulo?
--    Espeja `puedeEditarModulo` de src/lib/permisosModulo.ts + los allowlists de navVisibility.ts
--    y el `canEdit` real de cada página.
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
  IF v_perm IS NOT NULL THEN RETURN v_perm IN ('editar','supervisa'); END IF;

  IF v_rol = 'VIEWER' THEN RETURN false; END IF;                       -- Lector: solo lectura
  IF v_rol IN ('DUEÑO','SUPER_USUARIO','ADMIN') THEN RETURN true; END IF;

  -- Roles fijos operativos: allowlist por módulo.
  RETURN CASE p_modulo
    -- Productos usa `modulo: 'inventario'` en el nav; el form (`ProductoFormPage.canEdit`) habilita
    -- la edición a DUEÑO/SUPERVISOR/SUPER_USUARIO. DEPÓSITO ve la página en solo-lectura.
    WHEN 'inventario'    THEN v_rol = 'SUPERVISOR'
    WHEN 'configuracion' THEN false                                     -- ownerOnly
    ELSE false
  END;
END $$;

COMMENT ON FUNCTION public.auth_puede_editar_modulo(text) IS
  'Espejo server-side de puedeEditarModulo (src/lib/permisosModulo.ts) + allowlists de navVisibility. '
  'Devuelve true sin sesión (service_role/EF/cron) a propósito. Mig 396.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) F1-h2 + F1-h4 — `productos`: alta y cambio de PRECIOS.
--    Solo las columnas de precio. `stock_actual`, ubicación, etc. quedan libres para el flujo
--    operativo (el cajero las escribe en devoluciones/anulaciones).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_productos_rol_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.auth_puede_editar_modulo('inventario') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede dar de alta productos.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.precio_venta       IS DISTINCT FROM OLD.precio_venta
  OR NEW.precio_costo       IS DISTINCT FROM OLD.precio_costo
  OR NEW.precio_marketplace IS DISTINCT FROM OLD.precio_marketplace
  OR NEW.precio_usd         IS DISTINCT FROM OLD.precio_usd
  OR NEW.precio_costo_usd   IS DISTINCT FROM OLD.precio_costo_usd
  OR NEW.margen_objetivo    IS DISTINCT FROM OLD.margen_objetivo THEN
    IF NOT public.auth_puede_editar_modulo('inventario') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar precios de productos.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_productos_rol_guard ON public.productos;
CREATE TRIGGER trg_productos_rol_guard
  BEFORE INSERT OR UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.fn_productos_rol_guard();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) F1-h3 — `gastos`: quién escribe, y el UMBRAL del cajero server-side.
--    Espeja `evaluarUmbralGasto` (src/lib/umbralGasto.ts).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_gastos_rol_umbral_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_perm   text;
  v_umbral numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;   -- service_role / EF / cron

  SELECT u.rol, rc.permisos ->> 'gastos'
    INTO v_rol, v_perm
  FROM public.users u
  LEFT JOIN public.roles_custom rc ON rc.id = u.rol_custom_id AND rc.activo = true
  WHERE u.id = v_uid;

  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'No autorizado: usuario sin rol en el tenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Rol custom en solo-lectura sobre Gastos.
  IF v_perm IN ('no_ver','ver') THEN
    RAISE EXCEPTION 'No autorizado: tu rol tiene acceso de solo lectura en Gastos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_rol = 'VIEWER' THEN
    RAISE EXCEPTION 'No autorizado: el rol Lector es de solo lectura.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- DEPÓSITO y RRHH no tienen Gastos en el nav (ni `depositoVisible` ni `rrhhVisible`), salvo que
  -- un rol custom se lo habilite explícitamente.
  IF v_rol IN ('DEPOSITO','RRHH') AND v_perm IS NULL THEN
    RAISE EXCEPTION 'No autorizado: tu rol (%) no opera Gastos.', v_rol USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- CONTADOR ve Gastos pero la UI le esconde el alta (solo edita campos fiscales de un gasto ya
  -- creado) → se le bloquea el INSERT, no el UPDATE.
  IF v_rol = 'CONTADOR' AND v_perm IS NULL AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'No autorizado: el rol CONTADOR no da de alta gastos.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Umbral del CAJERO (v1.8.43). Sobre el umbral el gasto DEBE pasar por autorización, y esa
  -- autorización la aplica el aprobador con SU token — nunca el cajero. Por eso enforzar acá no
  -- puede romper el circuito de aprobación.
  --
  -- ⚠ El umbral del SUPERVISOR queda deliberadamente FUERA: el supervisor es quien aplica la
  -- autorización de un cajero, y si el monto pedido supera también su propio umbral, enforzarlo
  -- server-side rompería una aprobación legítima. Ese caso necesita antes mover la aplicación de
  -- autorizaciones a un RPC (mismo patrón que las migs 236/237/238). Anotado en la Tanda F.
  IF v_rol = 'CAJERO'
     AND (TG_OP = 'INSERT' OR NEW.monto IS DISTINCT FROM OLD.monto) THEN
    SELECT s.umbral_gasto_cajero INTO v_umbral
      FROM public.sucursales s WHERE s.id = NEW.sucursal_id;

    IF v_umbral IS NULL THEN
      RAISE EXCEPTION 'No autorizado: sin umbral de gasto configurado, un CAJERO necesita autorización para cualquier monto.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.monto > v_umbral THEN
      RAISE EXCEPTION 'No autorizado: el monto (%) supera tu umbral de gasto (%). Pedí autorización.', NEW.monto, v_umbral
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gastos_rol_umbral_guard ON public.gastos;
CREATE TRIGGER trg_gastos_rol_umbral_guard
  BEFORE INSERT OR UPDATE ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.fn_gastos_rol_umbral_guard();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) F1-h5 — `metodos_pago`: es configuración (`ownerOnly` en el nav). Lectura para todos —
--    el POS necesita listar los medios—, escritura solo para gestión.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS metodos_pago_tenant ON public.metodos_pago;

CREATE POLICY metodos_pago_select ON public.metodos_pago
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY metodos_pago_write_gestion ON public.metodos_pago
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO'])
  );

COMMIT;
