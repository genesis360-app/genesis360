-- 404 — La matriz de ESCRITURA: plata, precios y configuración dejan de escribirse desde cualquier rol
--
-- 🛑 REGLA #0 / Tanda F1, cierre. La auditoría de la mig 403 dejó esto medido y abierto: con el
-- token de un CAJERO y `curl` se podía escribir, por REST directo (filas afectadas en DEV):
--
--   cheques (19) · cliente_creditos (3) · caja_traspasos (2) · proveedor_cc_movimientos (17) ·
--   producto_precios_mayorista (68) · cupones (70) · cupones_codigos (160) · combos (25) ·
--   combo_items (25) · cuentas_origen (7) · sucursales (2) · canales_venta (17) ·
--   ubicaciones (102) · estados_inventario (202) · motivos_movimiento (5) · kit_recetas (11)
--
-- Dos cosas que gobiernan el diseño de esta migración, y que ya habían mordido en la mig 396:
--
--   1) **`producto_precios_mayorista`, `combos` y `cupones` son el precio de venta por la puerta de
--      al lado.** La mig 396 puso un trigger por columna sobre `productos.precio_*`, pero el mismo
--      rol podía editar la lista mayorista, armar un combo o crear un cupón del 90 % y vender al
--      precio que quisiera. Un guard que se esquiva por otra tabla no es un guard.
--
--   2) **El corte va por OPERACIÓN, no por tabla.** `VentasPage` INSERTA `cliente_creditos` en
--      devoluciones y anulaciones, y un CAJERO CREA cheques legítimamente al cobrar. Bloquear la
--      tabla entera rompe la venta. Por eso acá se separa por comando: INSERT operativo abierto,
--      UPDATE/DELETE de una fila que ya existe, no.
--
-- Quién escribe qué (verificado leyendo el frontend, no supuesto):
--   · ConfigPage / SucursalesPage / CanalesVentaPanel → `cuentas_origen`, `ubicaciones`,
--     `estados_inventario`, `motivos_movimiento`, `canales_venta`, `sucursales`. Las dos rutas son
--     `ownerOnly` en `AppLayout.tsx` → la base pasa a sostener lo mismo.
--   · ProveedoresPage (`ownerOnly`) → `proveedor_cuentas_bancarias`. Es el **CBU al que se le paga a
--     un proveedor**: cambiarlo redirige un pago. Hoy 0 filas en DEV y PROD, se cierra igual.
--   · ProductoFormPage → `producto_precios_mayorista`, `producto_stock_minimo_sucursal`. Mismo gate
--     que los precios de la mig 396.
--   · ComercialPage (`supervisorOnly`) → `combos`, `combo_items`, `cupones`, `cupones_codigos`.
--     ⚠ Pero `cupones_codigos` lo ESCRIBE TAMBIÉN LA VENTA: `VentasPage.tsx:3405` hace el claim
--     atómico del canje. Se me había escapado en un primer barrido porque el `.update()` está en la
--     línea siguiente al `.from()`; apareció al repetir el grep en modo multilínea. Un guard por
--     tabla acá habría roto la venta con cupón — ver el punto 2.b.
--   · InventarioPage → `kit_recetas`.
--   · VentasPage → `cliente_creditos` (solo INSERT; la app NUNCA hace UPDATE ni DELETE — el saldo a
--     favor es `SUM(monto)`, así que un UPDATE es plata inventada).
--   · ChequesPanel (dentro de GastosPage) + GastosPage → `cheques`.
--   · CajaPage → `caja_traspasos`.
--
-- Lo que queda AFUERA a propósito, porque necesita una definición de negocio de GO:
--   · `proveedor_cc_movimientos` — lo inserta ChequesPanel (que vive dentro de Gastos, donde el
--     CAJERO entra legítimamente) y ProveedoresPage (ownerOnly). Antes de cerrarlo hay que decidir
--     si un cajero puede registrar un pago a proveedor.
--   · `gastos_fijos` / `gasto_cuotas` — se escriben desde GastosPage, donde el CAJERO opera bajo su
--     UMBRAL (mig 396) y el CONTADOR es un actor legítimo. Cerrarlos por rol rompería a los dos.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0) `auth_puede_editar_modulo` suma el módulo COMERCIAL
--    (`/comercial` es `supervisorOnly` en el nav → OWNER+SUPERVISOR+ADMIN, más los roles custom
--    con 'comercial' en 'editar'/'supervisa', que ya salen por la rama de arriba.)
--    El resto de la función queda EXACTAMENTE igual que en la mig 396.
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
    WHEN 'comercial'     THEN v_rol = 'SUPERVISOR'                      -- supervisorOnly (mig 404)
    WHEN 'configuracion' THEN false                                     -- ownerOnly
    ELSE false
  END;
END $$;

COMMENT ON FUNCTION public.auth_puede_editar_modulo(text) IS
  'Espejo server-side de puedeEditarModulo (src/lib/permisosModulo.ts) + allowlists de navVisibility. '
  'Devuelve true sin sesión (service_role/EF/cron) a propósito. Migs 396 y 404.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Configuración pura — la escriben pantallas `ownerOnly`, así que la base exige lo mismo
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  policy_vieja text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_origen','canales_venta','sucursales','motivos_movimiento',
                           'estados_inventario','ubicaciones','proveedor_cuentas_bancarias']
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
        USING (tenant_id = public.get_user_tenant_id()
               AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
        WITH CHECK (tenant_id = public.get_user_tenant_id()
               AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
    $f$, t || '_write_gestion', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) El PRECIO DE VENTA por las otras puertas — mismo gate que el trigger de la mig 396
--    · lista mayorista y stock mínimo → módulo `inventario` (ProductoFormPage)
--    · combos y cupones              → módulo `comercial`  (ComercialPage)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  par record;
  policy_vieja text;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('producto_precios_mayorista','inventario'),
      ('producto_stock_minimo_sucursal','inventario'),
      ('combos','comercial'),
      ('combo_items','comercial'),
      ('cupones','comercial')
      -- `cupones_codigos` NO va acá: el POS lo ESCRIBE al canjear. Ver el punto 2.b.
    ) AS v(tabla, modulo)
  LOOP
    FOR policy_vieja IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=par.tabla
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_vieja, par.tabla);
    END LOOP;

    -- La LECTURA queda abierta al tenant: el POS necesita leer combos, cupones y la lista
    -- mayorista para cobrar. Lo que se cierra es la escritura.
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT USING (tenant_id = public.get_user_tenant_id())
    $f$, par.tabla || '_select', par.tabla);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL
        USING (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo(%L))
        WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.auth_puede_editar_modulo(%L))
    $f$, par.tabla || '_write', par.tabla, par.modulo, par.modulo);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2.b) `cupones_codigos` — el caso que casi rompe la venta
--
-- ⚠ Este NO se puede cerrar por tabla como sus hermanos: **el POS lo ESCRIBE al canjear**.
-- `VentasPage.tsx:3405` hace el claim atómico del cupón
-- (`UPDATE … SET usado_en_venta_id, usado_at WHERE usado_en_venta_id IS NULL`), y eso lo ejecuta el
-- CAJERO en cada venta con cupón. Un guard de módulo sobre la tabla habría dejado la venta sin
-- canjear el cupón — el mismo tipo de rotura que la mig 396 evitó en `productos`.
--
-- Corte real: **crear y borrar códigos es Comercial; marcarlos usados es la venta.** El UPDATE
-- queda abierto pero un trigger por COLUMNA impide cambiar el `codigo` o reasignar el `cupon_id`
-- (con eso se fabricaría un código de descuento a medida).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cupones_codigos_tenant ON public.cupones_codigos;

CREATE POLICY cupones_codigos_select ON public.cupones_codigos
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY cupones_codigos_insert ON public.cupones_codigos
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id()
                         AND public.auth_puede_editar_modulo('comercial'));

CREATE POLICY cupones_codigos_delete ON public.cupones_codigos
  FOR DELETE USING (tenant_id = public.get_user_tenant_id()
                    AND public.auth_puede_editar_modulo('comercial'));

-- El canje: abierto a quien vende.
CREATE POLICY cupones_codigos_update ON public.cupones_codigos
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.fn_cupones_codigos_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Lo único que la venta necesita tocar es el canje. Cambiar el código en sí, o colgarlo de otro
  -- cupón, es definir un descuento — eso es Comercial.
  IF NEW.codigo IS DISTINCT FROM OLD.codigo
  OR NEW.cupon_id IS DISTINCT FROM OLD.cupon_id THEN
    IF NOT public.auth_puede_editar_modulo('comercial') THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar el código ni el cupón de un código de descuento.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cupones_codigos_guard ON public.cupones_codigos;
CREATE TRIGGER trg_cupones_codigos_guard
  BEFORE UPDATE ON public.cupones_codigos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cupones_codigos_guard();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) `kit_recetas` — qué consume cada kit, o sea INVENTARIO
--
-- Se le suma DEPOSITO al gate a propósito: es el rol del depósito y arma kits. `auth_puede_editar_modulo`
-- ('inventario') no lo incluye porque en Productos el DEPÓSITO es solo-lectura. Cerrarlo para él
-- sería adivinar; lo que importa acá es sacar de la lista a CAJERO, RRHH, CONTADOR y LECTOR.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS kit_recetas_tenant ON public.kit_recetas;

CREATE POLICY kit_recetas_select ON public.kit_recetas
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY kit_recetas_write ON public.kit_recetas
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.auth_puede_editar_modulo('inventario') OR public.get_user_role() = 'DEPOSITO')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (public.auth_puede_editar_modulo('inventario') OR public.get_user_role() = 'DEPOSITO')
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) PLATA — acá el corte es por OPERACIÓN
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 4.a) `cliente_creditos` — saldo a favor del cliente.
-- La app SOLO hace INSERT (devoluciones y anulaciones, desde VentasPage) y SELECT (el saldo es
-- `SUM(monto)`). No hay un solo UPDATE ni DELETE en todo el frontend, así que un UPDATE por REST es
-- plata inventada: subís el monto de un crédito viejo y el cliente se lleva mercadería gratis.
DROP POLICY IF EXISTS cliente_creditos_tenant ON public.cliente_creditos;

CREATE POLICY cliente_creditos_select ON public.cliente_creditos
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY cliente_creditos_insert ON public.cliente_creditos
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY cliente_creditos_update_gestion ON public.cliente_creditos
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']))
  WITH CHECK (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));

CREATE POLICY cliente_creditos_delete_gestion ON public.cliente_creditos
  FOR DELETE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));

-- 4.b) `cheques`.
-- Registrar un cheque, cobrarlo, endosarlo o rechazarlo son operaciones del día a día y siguen
-- abiertas. Lo que NO puede hacer cualquiera es **cambiarle el MONTO a un cheque ya registrado**
-- (mismo criterio de columna que los precios de la mig 396) ni **borrarlo** (borrar un cheque en
-- cartera hace desaparecer plata del circuito sin rastro).
DROP POLICY IF EXISTS cheques_tenant ON public.cheques;

CREATE POLICY cheques_select ON public.cheques
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY cheques_insert ON public.cheques
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY cheques_update ON public.cheques
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY cheques_delete_gestion ON public.cheques
  FOR DELETE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));

CREATE OR REPLACE FUNCTION public.fn_cheques_monto_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.monto IS DISTINCT FROM OLD.monto THEN
    IF NOT (public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO','SUPERVISOR'])
            OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'No autorizado: tu rol no puede cambiar el monto de un cheque ya registrado.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cheques_monto_guard ON public.cheques;
CREATE TRIGGER trg_cheques_monto_guard
  BEFORE UPDATE ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.fn_cheques_monto_guard();

-- 4.c) `caja_traspasos`.
-- Hacer un traspaso entre cajas es operativo (INSERT, abierto). El UPDATE es otra cosa: es el flujo
-- "Corregir movimiento" de `CajaPage`, que el propio código anota como **DUEÑO/SUPERVISOR** —
-- gate que hasta ahora vivía solo en el cliente. Cambia el `monto` de un traspaso ya hecho.
DROP POLICY IF EXISTS traspasos_tenant ON public.caja_traspasos;

CREATE POLICY caja_traspasos_select ON public.caja_traspasos
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY caja_traspasos_insert ON public.caja_traspasos
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY caja_traspasos_update_supervision ON public.caja_traspasos
  FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO','SUPERVISOR']))
  WITH CHECK (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO','SUPERVISOR']));

CREATE POLICY caja_traspasos_delete_gestion ON public.caja_traspasos
  FOR DELETE
  USING (tenant_id = public.get_user_tenant_id()
         AND public.get_user_role() = ANY (ARRAY['DUEÑO','ADMIN','SUPER_USUARIO']));

COMMIT;

COMMENT ON FUNCTION public.fn_cheques_monto_guard() IS
  'Guard por COLUMNA (mig 404): registrar/cobrar/endosar un cheque es operativo, cambiarle el MONTO '
  'a uno ya registrado no. Mismo criterio que fn_productos_rol_guard con los precios.';
