-- Migration 278: Hard delete REAL de productos (individual + bulk), solo si nunca tuvieron
-- actividad. GO pidió que el botón "Eliminar" de la ficha de producto (ProductoFormPage) deje de
-- ser un soft-delete (antes hacía UPDATE productos SET activo=false — idéntico al toggle
-- "Activo/Inactivo" que ya existe en el mismo form, redundante) y borre la fila de verdad.
--
-- "Sin stock actual" (el check viejo, vía inventario_lineas) NO alcanza como criterio: un producto
-- vendido y agotado tiene stock_actual=0 hoy pero sigue teniendo historial. schema_full.sql muestra
-- que muchas tablas operativas referencian productos(id) SIN ON DELETE (⇒ RESTRICT): venta_items,
-- movimientos_stock, orden_compra_items, recepcion_items, traslado_items, inventario_conteo_items,
-- inventario_lineas, inventario_series, devolucion_items, devolucion_proveedor_items, combo_items —
-- y algunas con ON DELETE SET NULL (envio_items, venta_item_despachos, inventario_conteos), que
-- silenciarían la trazabilidad de qué producto se vendió/envió/contó en un registro histórico si el
-- delete avanzara. El único criterio seguro es "cero actividad en TODA la vida del producto".
--
-- fn_producto_tiene_actividad es SECURITY DEFINER a propósito (se aparta del patrón SECURITY
-- INVOKER de las RPC de kitting, mig 244): varias de esas tablas tienen RLS filtrado POR SUCURSAL
-- (auth_user_sucursal()) — movimientos_stock, inventario_lineas, orden_compra_items,
-- recepcion_items, envio_items, venta_items, venta_item_despachos, inventario_conteo_items/
-- inventario_conteos. Un usuario logueado en la sucursal A (sin auth_ve_todas_sucursales()) NO
-- vería, vía RLS normal, la actividad de ese producto en la sucursal B, y borraría un producto con
-- historial real en otra sucursal sin darse cuenta. El chequeo de actividad tiene que ser
-- tenant-wide, no sucursal-wide → bypassea RLS de sucursal pero valida tenant_id a mano en cada
-- función (nunca opera fuera del tenant del que llama).

CREATE OR REPLACE FUNCTION public.fn_producto_tiene_actividad(p_producto_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_caller_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM productos WHERE id = p_producto_id;
  IF v_tenant_id IS NULL THEN
    RETURN true; -- no existe: tratarlo como no-eliminable, que el caller lo reporte como tal
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM users WHERE id = auth.uid();
  IF v_caller_tenant IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN
       EXISTS (SELECT 1 FROM movimientos_stock         WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM venta_items                WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM orden_compra_items         WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM recepcion_items            WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM traslado_items             WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM inventario_conteo_items    WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM inventario_conteos         WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM devolucion_items           WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM devolucion_proveedor_items WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM envio_items                WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM venta_item_despachos       WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM inventario_lineas          WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM inventario_series          WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM combo_items                WHERE producto_id = p_producto_id)
    -- combos.producto_id / kit_recetas / kitting_log son ON DELETE CASCADE: sin este chequeo,
    -- borrar un producto que es cabecera de combo o kit (o componente de la receta de OTRO kit)
    -- arrastraría en cascada filas de combo_items / kit_recetas que pertenecen a OTROS productos,
    -- y borraría el historial de armado/desarmado (kitting_log) sin dejar rastro.
    OR EXISTS (SELECT 1 FROM combos      WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM kit_recetas WHERE kit_producto_id = p_producto_id OR comp_producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM kitting_log WHERE kit_producto_id = p_producto_id)
    -- mapeos de marketplace: también CASCADE; no es histórico/fiscal, pero borrarlos en silencio
    -- puede desincronizar stock/precio del lado de MercadoLibre/Tiendanube sin que nadie se entere.
    OR EXISTS (SELECT 1 FROM inventario_meli_map WHERE producto_id = p_producto_id)
    OR EXISTS (SELECT 1 FROM inventario_tn_map   WHERE producto_id = p_producto_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_producto_tiene_actividad(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_producto_tiene_actividad(UUID) TO authenticated;

COMMENT ON FUNCTION public.fn_producto_tiene_actividad(UUID) IS
  'Chequea si un producto tuvo CUALQUIER actividad histórica (venta, movimiento, recepción, OC, traslado, conteo, devolución, envío, combo) en cualquier sucursal del tenant. SECURITY DEFINER para no quedar limitado por RLS de sucursal. Guard obligatorio antes de un hard delete real de productos.';

-- eliminar_productos_fisico: intenta un DELETE FROM productos real por cada id (uno por uno, cada
-- uno en su propio sub-bloque para que un fallo puntual no aborte el resto del batch). Devuelve el
-- resultado por producto para que la UI reporte parciales tipo "5 eliminados · 2 bloqueados".
CREATE OR REPLACE FUNCTION public.eliminar_productos_fisico(p_ids UUID[])
RETURNS TABLE(producto_id UUID, eliminado BOOLEAN, motivo TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tenant_id UUID;
  v_caller_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_caller_tenant FROM users WHERE id = auth.uid();
  IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT tenant_id INTO v_tenant_id FROM productos WHERE id = v_id;

    IF v_tenant_id IS NULL THEN
      producto_id := v_id; eliminado := false; motivo := 'no_encontrado';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_tenant_id IS DISTINCT FROM v_caller_tenant THEN
      producto_id := v_id; eliminado := false; motivo := 'no_autorizado';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF fn_producto_tiene_actividad(v_id) THEN
      producto_id := v_id; eliminado := false; motivo := 'tiene_actividad';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      -- "producto_id" calificado con el nombre de tabla: eliminar_productos_fisico devuelve una
      -- columna OUT llamada producto_id, y plpgsql trata el identificador sin calificar como
      -- ambiguo entre esa variable OUT y la columna de la tabla (plpgsql.variable_conflict=error
      -- por default) → "column reference producto_id is ambiguous" en runtime.
      DELETE FROM alertas WHERE alertas.producto_id = v_id; -- notificaciones, no historial: se limpian solas
      DELETE FROM productos WHERE productos.id = v_id;
      producto_id := v_id; eliminado := true; motivo := NULL;
    EXCEPTION
      WHEN foreign_key_violation THEN
        -- backstop: fn_producto_tiene_actividad ya debería haber filtrado esto antes.
        producto_id := v_id; eliminado := false; motivo := 'tiene_actividad';
      WHEN OTHERS THEN
        -- error real (no un bloqueo esperado) — no lo disfracemos de "tiene actividad".
        producto_id := v_id; eliminado := false; motivo := 'error: ' || SQLERRM;
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_productos_fisico(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_productos_fisico(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.eliminar_productos_fisico(UUID[]) IS
  'Hard delete real de productos (DELETE FROM productos), uno por uno, solo si fn_producto_tiene_actividad da false. Devuelve el resultado por id para que la UI reporte parciales. Ver mig 278 / CLAUDE.md Regla #0.';
