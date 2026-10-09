-- 491 — Correcciones de la revisión de 489/490 (picking con ubicaciones Globales, UAT §111) — REGLA #0, inventario
--
--   1. fn_unpick_tarea_wms → SECURITY DEFINER. Si B des-pickeaba una tarea suya de un pedido de A, la RLS le ocultaba el
--      pedido: v_pedido quedaba vacío → el guard de entregado/cancelado no frenaba y se trataba como pedido sin venta (el LPN
--      nuevo sin reserva y la anotación de la venta apuntando al LPN viejo). Ahora el acceso se controla por la TAREA (su
--      sucursal) y un pedido inexistente frena.
--   2. fn_pedido_marcar_listo: lockea el pedido antes de evaluar. Con las dos últimas tareas completadas a la vez (A y B),
--      cada transacción veía la otra pendiente y el pedido nunca quedaba listo. Además exige al menos una tarea completada.
--   3. fn_generar_tareas_picking_pedido_venta: el fallback no repite un LPN que ya tiene tarea en el lanzamiento (con una
--      reserva parcial salía una segunda tarea sobre el mismo LPN por su cantidad completa); un LPN sin reservar ofrece solo
--      lo libre; relanzar ignora las tareas canceladas; desempate estable en la fuente reservada.
--   4. fn_pedido_liberar_tareas_pendientes: solo la ejecutan deshacer / cancelar (DEFINER) y service_role — llamada suelta,
--      cancelaba tareas sin deshacer el pedido.
--   5. deshacer lanzamiento / cancelar: no si OTRA sucursal tiene una tarea en curso.

-- ── 1. Des-pickear ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_unpick_tarea_wms(p_tarea_id uuid, p_ubicacion_destino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tarea      RECORD;
  v_pedido     RECORD;
  v_linea      RECORD;
  v_nuevo_lpn  text;
  v_nueva_id   uuid;
  v_restante   integer;
  v_tomar      integer;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  -- Mig 491: DEFINER (la sucursal dueña del LPN des-pickea una tarea de un pedido de OTRA sucursal, que la RLS le oculta).
  -- Acceso: la tarea es del negocio y, para un usuario restringido, de su sucursal (la que la hizo).
  BEGIN
    PERFORM fn_venta_reserva_check_acceso(v_tarea.tenant_id, v_tarea.sucursal_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'Tarea inexistente o sin permisos';
  END;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Solo se puede deshacer (des-pickear) una tarea de picking'; END IF;
  IF v_tarea.estado <> 'completada' THEN RAISE EXCEPTION 'Esta tarea no está completada'; END IF;
  IF v_tarea.pedido_id IS NULL THEN RAISE EXCEPTION 'El des-pickeo solo está disponible para tareas originadas en un Pedido'; END IF;
  IF p_ubicacion_destino_id IS NULL THEN RAISE EXCEPTION 'Elegí una ubicación destino para reubicar el LPN'; END IF;

  SELECT * INTO v_pedido FROM pedidos WHERE id = v_tarea.pedido_id FOR UPDATE;
  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Pedido inexistente'; END IF;
  IF v_pedido.estado IN ('entregado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido ya está % — no se puede deshacer el picking', v_pedido.estado;
  END IF;

  v_restante := v_tarea.cantidad;

  FOR v_linea IN
    SELECT il.id, il.cantidad, il.cantidad_reservada, il.estado_id, il.nro_lote, il.fecha_vencimiento,
           il.pais_origen, il.proveedor_id, il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
    FROM inventario_lineas il
    WHERE il.tenant_id = v_tarea.tenant_id AND il.producto_id = v_tarea.producto_id
      AND il.ubicacion_id = v_tarea.ubicacion_origen_id AND il.lpn = v_tarea.lpn_origen
      AND il.activo = true
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
    IF v_tomar <= 0 THEN CONTINUE; END IF;

    UPDATE inventario_lineas SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
      activo = (cantidad - v_tomar) > 0 WHERE id = v_linea.id;

    v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    -- Mig 488: en un pedido de VENTA lo des-pickeado sigue reservado para esa venta (antes quedaba libre y la venta
    -- reservada se quedaba sin stock reservado).
    INSERT INTO inventario_lineas
      (tenant_id, producto_id, lpn, cantidad, cantidad_reservada, estado_id, ubicacion_id, sucursal_id, proveedor_id,
       nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
    VALUES
      (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar,
       CASE WHEN v_pedido.venta_origen_id IS NOT NULL THEN v_tomar ELSE 0 END,
       v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
       v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma)
    RETURNING id INTO v_nueva_id;
    IF v_pedido.venta_origen_id IS NOT NULL THEN
      PERFORM fn_venta_reservas_mover_anotacion(v_pedido.venta_origen_id, v_linea.id, v_nueva_id, v_tomar);
    END IF;

    v_restante := v_restante - v_tomar;
  END LOOP;

  IF v_restante > 0 AND v_tarea.tarea_precedente_id IS NOT NULL THEN
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.estado_id, il.nro_lote, il.fecha_vencimiento,
             il.pais_origen, il.proveedor_id, il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
      FROM inventario_lineas il
      WHERE il.tenant_id = v_tarea.tenant_id AND il.producto_id = v_tarea.producto_id
        AND il.ubicacion_id = v_tarea.ubicacion_origen_id
        AND il.activo = true AND COALESCE(il.cantidad_reservada, 0) > 0
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      UPDATE inventario_lineas SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
        activo = (cantidad - v_tomar) > 0 WHERE id = v_linea.id;

      v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      INSERT INTO inventario_lineas
        (tenant_id, producto_id, lpn, cantidad, cantidad_reservada, estado_id, ubicacion_id, sucursal_id, proveedor_id,
         nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
      VALUES
        (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar,
         CASE WHEN v_pedido.venta_origen_id IS NOT NULL THEN v_tomar ELSE 0 END,
         v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
         v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma)
      RETURNING id INTO v_nueva_id;
      IF v_pedido.venta_origen_id IS NOT NULL THEN
        PERFORM fn_venta_reservas_mover_anotacion(v_pedido.venta_origen_id, v_linea.id, v_nueva_id, v_tomar);
      END IF;

      v_restante := v_restante - v_tomar;
    END LOOP;
  END IF;

  IF v_restante > 0 THEN
    IF v_tarea.tarea_precedente_id IS NOT NULL THEN
      RAISE EXCEPTION 'No se encontró stock reservado suficiente del producto en la ubicación de picking para des-pickear esta tarea — puede que ya se haya generado la venta';
    ELSE
      RAISE EXCEPTION 'No se encontró el LPN reservado (%) — puede que ya se haya generado la venta o se haya movido de otra forma', v_tarea.lpn_origen;
    END IF;
  END IF;

  UPDATE wms_tareas SET estado = 'cancelada',
    notas = COALESCE(notas || ' — ', '') || 'Des-pickeado: reubicado en otra ubicación'
  WHERE id = p_tarea_id;
END;
$function$;

-- ── 2. Pedido listo: lock + al menos una tarea completada ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_marcar_listo(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pedidos WHERE id = p_pedido_id AND tenant_id = get_user_tenant_id()) THEN
    RETURN;
  END IF;
  -- Serializa a los que completan las últimas tareas a la vez: el segundo espera y re-evalúa con el primero confirmado.
  PERFORM 1 FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  UPDATE pedidos p SET estado = 'listo_para_entrega'
   WHERE p.id = p_pedido_id AND p.estado = 'en_preparacion'
     AND EXISTS (SELECT 1 FROM wms_tareas w WHERE w.pedido_id = p_pedido_id AND w.tipo = 'picking' AND w.estado = 'completada')
     AND NOT EXISTS (
       SELECT 1 FROM wms_tareas w
       WHERE w.pedido_id = p_pedido_id AND w.tipo = 'picking'
         AND w.estado NOT IN ('completada', 'cancelada'));
END;
$$;

-- ── 3. Lanzar ──────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido_venta(p_pedido_id uuid)
 RETURNS TABLE(tarea_id uuid, tipo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD; v_item RECORD; v_fuente RECORD; v_pick_id uuid;
  v_ubic_tipo text; v_domicilio_id uuid; v_pendiente numeric; v_hubo boolean;
BEGIN
  PERFORM fn_pedido_check_acceso(p_pedido_id);
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — usá fn_generar_tareas_picking_pedido';
  END IF;
  -- Mig 491: las tareas CANCELADAS (deshacer lanzamiento) no cuentan: si no, relanzar devolvía las viejas y el pedido no
  -- volvía a "en preparación".
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado <> 'cancelada') THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id AND wt.estado <> 'cancelada';
    RETURN;
  END IF;
  IF v_pedido.estado = 'cancelado' THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo'; END IF;

  FOR v_item IN
    SELECT pi.producto_id, (pi.cantidad - pi.cantidad_entregada) AS cantidad
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
      AND (pi.cantidad - pi.cantidad_entregada) > 0
  LOOP
    v_pendiente := v_item.cantidad;
    v_hubo := false;

    FOR v_fuente IN
      -- 0 (mig 490): lo que la venta RESERVÓ (mig 488) — la verdad, incluido el stock de otra sucursal en una Global.
      SELECT il.lpn, il.ubicacion_id, il.sucursal_id, SUM(r.cantidad) AS cantidad, 0 AS prio
      FROM venta_item_reservas r
      JOIN inventario_lineas il ON il.id = r.linea_id
      WHERE r.venta_id = v_pedido.venta_origen_id AND r.producto_id = v_item.producto_id
      GROUP BY il.lpn, il.ubicacion_id, il.sucursal_id
      UNION ALL
      SELECT vid.lpn, vid.ubicacion_id, il.sucursal_id, SUM(vid.cantidad) AS cantidad, 1 AS prio
      FROM venta_item_despachos vid
      LEFT JOIN inventario_lineas il ON il.id = vid.linea_id
      WHERE vid.venta_id = v_pedido.venta_origen_id AND vid.producto_id = v_item.producto_id
        AND vid.cantidad > 0
        AND NOT EXISTS (SELECT 1 FROM venta_item_reservas r2
                        WHERE r2.venta_id = v_pedido.venta_origen_id AND r2.producto_id = v_item.producto_id)
      GROUP BY vid.lpn, vid.ubicacion_id, il.sucursal_id
      UNION ALL
      SELECT il.lpn, il.ubicacion_id, il.sucursal_id, SUM((p->>'cantidad')::numeric) AS cantidad, 2 AS prio
      FROM venta_items vi
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vi.lpn_plan, '[]'::jsonb)) p
      JOIN inventario_lineas il ON il.id = (p->>'linea_id')::uuid
      WHERE vi.venta_id = v_pedido.venta_origen_id AND vi.producto_id = v_item.producto_id
        AND NOT EXISTS (SELECT 1 FROM venta_item_despachos d
                        WHERE d.venta_id = v_pedido.venta_origen_id AND d.producto_id = v_item.producto_id)
        AND NOT EXISTS (SELECT 1 FROM venta_item_reservas r3
                        WHERE r3.venta_id = v_pedido.venta_origen_id AND r3.producto_id = v_item.producto_id)
        AND (p->>'cantidad')::numeric > 0
        -- Sin reserva anotada, el plan solo vale dentro de la sucursal del pedido (estricto, como antes).
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
      GROUP BY il.lpn, il.ubicacion_id, il.sucursal_id
      ORDER BY prio, ubicacion_id, lpn
    LOOP
      EXIT WHEN v_pendiente <= 0;
      SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                              ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, COALESCE(v_fuente.sucursal_id, v_pedido.sucursal_id), 'picking', v_item.producto_id,
              LEAST(v_fuente.cantidad, v_pendiente), v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_item.producto_id, LEAST(v_fuente.cantidad, v_pendiente)::integer)
                || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' — fuera de zona de picking' ELSE '' END
                || CASE WHEN v_fuente.sucursal_id IS NOT NULL AND v_pedido.sucursal_id IS NOT NULL
                             AND v_fuente.sucursal_id <> v_pedido.sucursal_id
                        THEN ' — para ' || COALESCE((SELECT s.nombre FROM sucursales s WHERE s.id = v_pedido.sucursal_id), 'otra sucursal')
                        ELSE '' END)
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
      v_pendiente := v_pendiente - LEAST(v_fuente.cantidad, v_pendiente);
      v_hubo := true;
    END LOOP;

    IF v_pendiente > 0 THEN
      FOR v_fuente IN
        -- Mig 491: un LPN que ya tiene tarea en este lanzamiento no se vuelve a ofrecer (antes, con una reserva parcial,
        -- salía una segunda tarea sobre el mismo LPN por su cantidad completa), y un LPN sin reservar ofrece solo lo libre.
        SELECT il.lpn, il.ubicacion_id, il.sucursal_id,
               (CASE WHEN COALESCE(il.cantidad_reservada,0) > 0 THEN il.cantidad
                     ELSE il.cantidad - COALESCE(il.cantidad_reservada,0) END) AS cantidad,
               (CASE WHEN COALESCE(il.cantidad_reservada,0) > 0 THEN 3 ELSE 4 END) AS prio
        FROM inventario_lineas il
        WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
          AND il.activo = true AND il.cantidad > 0
          AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
          AND NOT EXISTS (SELECT 1 FROM wms_tareas w
                           WHERE w.pedido_id = p_pedido_id AND w.estado <> 'cancelada'
                             AND w.lpn_origen IS NOT DISTINCT FROM il.lpn
                             AND w.ubicacion_origen_id IS NOT DISTINCT FROM il.ubicacion_id)
        ORDER BY prio, il.fecha_vencimiento NULLS LAST, il.created_at
      LOOP
        EXIT WHEN v_pendiente <= 0;
        SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                                ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, COALESCE(v_fuente.sucursal_id, v_pedido.sucursal_id), 'picking', v_item.producto_id,
                LEAST(v_fuente.cantidad, v_pendiente), v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
                fn_wms_describir_cantidad(v_item.producto_id, LEAST(v_fuente.cantidad, v_pendiente)::integer)
                  || CASE WHEN v_fuente.prio = 3 THEN ' — LPN sugerido (la venta reservó acá)'
                          ELSE ' — LPN sugerido por FEFO' END
                  || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ', fuera de zona de picking' ELSE '' END)
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;
        v_pendiente := v_pendiente - LEAST(v_fuente.cantidad, v_pendiente);
        v_hubo := true;
      END LOOP;
    END IF;

    IF NOT v_hubo THEN
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_item.cantidad,
              'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_item.producto_id, v_item.cantidad::integer)
                || ' — ⚠ sin stock ubicado para este producto')
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END IF;
  END LOOP;

  IF v_pedido.requiere_envio
     AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = p_pedido_id)
     AND NOT EXISTS (SELECT 1 FROM envios WHERE venta_id = v_pedido.venta_origen_id) THEN
    v_domicilio_id := NULL;
    IF v_pedido.cliente_id IS NOT NULL THEN
      SELECT cd.id INTO v_domicilio_id FROM cliente_domicilios cd
      WHERE cd.cliente_id = v_pedido.cliente_id
      ORDER BY cd.es_principal DESC, cd.created_at LIMIT 1;
    END IF;
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, venta_id, destino_id, canal, estado, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_pedido.venta_origen_id,
            v_domicilio_id, 'Pedidos', 'pendiente',
            'Generado automáticamente al lanzar el Pedido #' || v_pedido.numero);
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid()
  WHERE id = p_pedido_id;
  RETURN;
END;
$function$;

-- ── 5. Deshacer lanzamiento / cancelar ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_deslanzar(p_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD;
BEGIN
  PERFORM fn_pedido_check_acceso(p_pedido_id);
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.estado <> 'en_preparacion' THEN
    RAISE EXCEPTION 'Solo se puede deshacer el lanzamiento de un pedido en preparación';
  END IF;

  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado = 'completada') THEN
    RAISE EXCEPTION 'Hay una tarea de picking ya completada (o un reabastecimiento completado con un picking encadenado todavía pendiente) — completá o des-pickeá esa tarea antes de deshacer el lanzamiento';
  END IF;

  -- Mig 491: si la sucursal dueña de un LPN (otra) ya está pickeando, no se le cancela la tarea en la cara.
  IF EXISTS (SELECT 1 FROM wms_tareas w WHERE w.pedido_id = p_pedido_id AND w.estado = 'en_curso'
             AND w.sucursal_id IS DISTINCT FROM v_pedido.sucursal_id) THEN
    RAISE EXCEPTION 'Otra sucursal está pickeando este pedido ahora (tarea en curso): esperá a que la termine o la libere';
  END IF;

  PERFORM fn_pedido_liberar_tareas_pendientes(p_pedido_id);

  UPDATE envios SET estado = 'cancelado'
  WHERE pedido_id = p_pedido_id AND venta_id IS NULL AND estado NOT IN ('cancelado', 'entregado');

  UPDATE pedidos SET estado = 'confirmado', lanzado_at = NULL, lanzado_por = NULL WHERE id = p_pedido_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancelar_pedido(p_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD;
BEGIN
  PERFORM fn_pedido_check_acceso(p_pedido_id);
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.estado IN ('cancelado', 'entregado') THEN
    RAISE EXCEPTION 'El pedido ya está % — no se puede cancelar', v_pedido.estado;
  END IF;

  IF EXISTS (SELECT 1 FROM ventas WHERE pedido_id = p_pedido_id AND estado NOT IN ('cancelada', 'devuelta')) THEN
    RAISE EXCEPTION 'Este pedido ya generó una venta real (entrega parcial o total) — para cancelarlo hay que devolver esa venta primero desde Ventas → Historial';
  END IF;

  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado = 'completada') THEN
    RAISE EXCEPTION 'Hay una tarea de picking ya completada (o un reabastecimiento completado con un picking encadenado todavía pendiente) — completá o des-pickeá esa tarea antes de cancelar';
  END IF;

  -- Mig 491: si la sucursal dueña de un LPN (otra) ya está pickeando, no se le cancela la tarea en la cara.
  IF EXISTS (SELECT 1 FROM wms_tareas w WHERE w.pedido_id = p_pedido_id AND w.estado = 'en_curso'
             AND w.sucursal_id IS DISTINCT FROM v_pedido.sucursal_id) THEN
    RAISE EXCEPTION 'Otra sucursal está pickeando este pedido ahora (tarea en curso): esperá a que la termine o la libere';
  END IF;

  PERFORM fn_pedido_liberar_tareas_pendientes(p_pedido_id);

  UPDATE envios SET estado = 'cancelado'
  WHERE pedido_id = p_pedido_id AND venta_id IS NULL AND estado NOT IN ('cancelado', 'entregado');

  UPDATE pedidos SET estado = 'cancelado', cancelado_at = now() WHERE id = p_pedido_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_unpick_tarea_wms(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unpick_tarea_wms(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_pedido_liberar_tareas_pendientes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pedido_liberar_tareas_pendientes(uuid) TO service_role;
