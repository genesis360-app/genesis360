-- 472 — Categorías de clientes: rediseño de la pantalla (pedido de GO 2026-10-05)
--
--  1. Permisos POR USUARIO, además de por rol. Las listas `tenants.categorias_cliente_roles` (crear/editar) y
--     `categorias_cliente_asignar_roles` (asignar a clientes) aceptan ahora también 'user:<uuid>'. Se configuran en
--     Configuración → Clientes (solo el DUEÑO), con pestañas Roles / Usuarios. El DUEÑO (y el staff ADMIN) siempre puede.
--  2. Eliminar una categoría: SOLO el DUEÑO (y ADMIN). Sigue valiendo C2 (solo si nunca se usó: lo frena el trigger
--     fn_categorias_cliente_guard_delete); antes la policy dejaba borrar a cualquiera con permiso de gestionar.
--  3. `fn_descuentos_categoria_masivo`: aplicar un % (o quitar el descuento) a muchos productos de una lista en una sola
--     operación — la fila de una categoría de productos y el botón "Acciones" de la pantalla nueva. Deja UNA entrada en
--     el historial de la categoría, no una por producto (mismo criterio que la importación, mig 466).
--  4. `fn_clientes_compras_resumen`: compras, total gastado (para el ticket promedio) por cliente, para el modal de
--     asignar clientes. Ventas despachadas, facturadas o reservadas, menos lo devuelto. Con la RLS del usuario.

-- ── 1. Permisos por usuario ──────────────────────────────────────────────────────────────────────────────────────────
-- Definición vigente de la mig 442 (ninguna migración posterior la tocó) + la línea de 'user:'.
CREATE OR REPLACE FUNCTION public.fn_usuario_en_roles_categoria(p_columna text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol text; v_custom uuid; v_tenant uuid; v_lista jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN true; END IF;
  SELECT rol, rol_custom_id, tenant_id INTO v_rol, v_custom, v_tenant FROM users WHERE id = auth.uid() AND activo IS NOT FALSE;
  IF v_rol IS NULL THEN RETURN false; END IF;
  IF v_rol IN ('DUEÑO', 'ADMIN') THEN RETURN true; END IF;
  IF p_columna = 'gestionar' THEN
    SELECT categorias_cliente_roles INTO v_lista FROM tenants WHERE id = v_tenant;
  ELSIF p_columna = 'asignar' THEN
    SELECT categorias_cliente_asignar_roles INTO v_lista FROM tenants WHERE id = v_tenant;
  ELSE
    RETURN false;
  END IF;
  RETURN v_lista IS NOT NULL AND (
    v_lista ? v_rol
    OR (v_custom IS NOT NULL AND v_lista ? ('custom:' || v_custom::text))
    OR v_lista ? ('user:' || auth.uid()::text));   -- mig 472: permiso directo a un usuario
END;
$function$;

-- ── 2. Eliminar: solo el DUEÑO ───────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS categorias_cliente_delete ON public.categorias_cliente;
CREATE POLICY categorias_cliente_delete ON public.categorias_cliente FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id()
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.rol IN ('DUEÑO', 'ADMIN') AND u.activo IS NOT FALSE));

-- ── 3. Cambio masivo de una lista ────────────────────────────────────────────────────────────────────────────────────
-- p_pct NULL = quitar el descuento ("sin cargar"); 0 = sin descuento a propósito (C4).
CREATE OR REPLACE FUNCTION public.fn_descuentos_categoria_masivo(p_categoria_id uuid, p_producto_ids uuid[], p_pct numeric, p_detalle text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cat    text;
  v_n      int;
  v_ajenos int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin negocio'; END IF;
  IF NOT fn_usuario_en_roles_categoria('gestionar') THEN
    RAISE EXCEPTION 'No tenés permiso para modificar las listas de descuento de las categorías';
  END IF;
  SELECT nombre INTO v_cat FROM categorias_cliente WHERE id = p_categoria_id AND tenant_id = v_tenant;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Categoría no encontrada'; END IF;
  v_n := COALESCE(array_length(p_producto_ids, 1), 0);
  IF v_n = 0 THEN RAISE EXCEPTION 'No hay productos elegidos'; END IF;
  IF v_n > 20000 THEN RAISE EXCEPTION 'Demasiados productos de una vez (máximo 20.000)'; END IF;
  IF p_pct IS NOT NULL AND (p_pct < 0 OR p_pct > 100 OR p_pct <> round(p_pct, 2)) THEN
    RAISE EXCEPTION 'El descuento va de 0 a 100, con hasta 2 decimales';
  END IF;
  SELECT count(*) INTO v_ajenos FROM unnest(p_producto_ids) x(id)
   WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.id = x.id AND p.tenant_id = v_tenant);
  IF v_ajenos > 0 THEN RAISE EXCEPTION 'Hay productos que no son de este negocio'; END IF;

  PERFORM set_config('g360.cat_desc_importando', '1', true);   -- sin una entrada por producto (ver abajo)
  IF p_pct IS NULL THEN
    DELETE FROM categoria_cliente_descuentos WHERE categoria_id = p_categoria_id AND producto_id = ANY (p_producto_ids);
  ELSE
    INSERT INTO categoria_cliente_descuentos (tenant_id, categoria_id, producto_id, descuento_pct)
    SELECT DISTINCT v_tenant, p_categoria_id, x.id, p_pct FROM unnest(p_producto_ids) x(id)
    ON CONFLICT (categoria_id, producto_id) DO UPDATE SET descuento_pct = EXCLUDED.descuento_pct;
  END IF;
  PERFORM set_config('g360.cat_desc_importando', '', true);

  INSERT INTO actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre, accion, campo,
                             valor_anterior, valor_nuevo, pagina)
  VALUES (v_tenant, auth.uid(), COALESCE((SELECT nombre_display FROM users WHERE id = auth.uid()), 'Sistema'),
          'categoria_cliente', p_categoria_id::text, v_cat, 'editar', 'lista de descuentos', NULL,
          CASE WHEN p_pct IS NULL THEN format('%s productos sin cargar', v_n)
               ELSE format('%s productos a %s %%', v_n,
                      replace(trim(trailing '.' FROM trim(trailing '0' FROM p_pct::text)), '.', ',')) END
          || COALESCE(' (' || left(p_detalle, 120) || ')', ''),
          '/clientes');

  RETURN jsonb_build_object('productos', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_descuentos_categoria_masivo(uuid, uuid[], numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_descuentos_categoria_masivo(uuid, uuid[], numeric, text) TO authenticated;

-- ── 4. Resumen de compras por cliente ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_clientes_compras_resumen()
RETURNS TABLE (cliente_id uuid, compras bigint, total numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT v.cliente_id, count(*)::bigint,
         round(sum(v.total - COALESCE((SELECT sum(d.monto_total) FROM devoluciones d WHERE d.venta_id = v.id), 0)), 2)
    FROM ventas v
   WHERE v.tenant_id = public.get_user_tenant_id()
     AND v.cliente_id IS NOT NULL
     AND v.estado IN ('despachada', 'facturada', 'reservada')
   GROUP BY v.cliente_id;
$$;
REVOKE ALL ON FUNCTION public.fn_clientes_compras_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_compras_resumen() TO authenticated;
