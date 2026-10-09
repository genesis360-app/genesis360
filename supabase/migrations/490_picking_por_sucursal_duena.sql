-- 490 — Picking por la sucursal DUEÑA del stock — Fase 2 de "ubicaciones Globales" (UAT §111)
--
-- Decisión de GO (2026-10-08): una venta de A que usa stock de B (en una ubicación Global) genera un pedido de A cuya tarea
-- de picking la ve y la hace B; A ve el avance en solo lectura; cuando B termina, el pedido pasa a "listo para entrega" y
-- A lo entrega.
--
-- Con la RLS por sucursal (pedidos / wms_tareas / inventario_lineas), las funciones INVOKER no alcanzaban:
--   · lanzar el pedido (lo hace A) no veía el LPN de B → no generaba su tarea, o la generaba con la sucursal de A;
--   · completar la última tarea (lo hace B) no veía el pedido de A → el pedido nunca pasaba a "listo para entrega";
--   · deshacer el lanzamiento / cancelar (lo hace A) no veía las tareas de B → podía deshacer un pedido ya pickeado por B y
--     dejar sus tareas pendientes para siempre;
--   · el detalle del pedido en A no mostraba las tareas de B, y B no sabía de qué pedido / para qué sucursal pickeaba.
--
-- Cambios (todos con chequeo explícito de acceso: mismo tenant y, para un usuario restringido, la sucursal del pedido):
--   1. fn_generar_tareas_picking_pedido_venta → SECURITY DEFINER; fuente nueva prioritaria = venta_item_reservas (lo que la
--      venta reservó de verdad, mig 488); cada tarea toma la sucursal DEL LPN (si no hay LPN, la del pedido).
--   2. fn_pedido_marcar_listo (DEFINER) — la usa fn_completar_tarea_picking.
--   3. fn_pedido_deslanzar / fn_cancelar_pedido / fn_pedido_liberar_tareas_pendientes → SECURITY DEFINER.
--   4. Lecturas para la UI: fn_pedido_tareas_detalle (avance de un pedido, todas las sucursales) y fn_pedidos_de_mis_tareas
--      (número / estado / sucursal destino de los pedidos de las tareas que el usuario ve).

-- ── Acceso a un pedido ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_check_acceso(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v RECORD;
BEGIN
  SELECT tenant_id, sucursal_id INTO v FROM pedidos WHERE id = p_pedido_id;
  IF v.tenant_id IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  PERFORM fn_venta_reserva_check_acceso(v.tenant_id, v.sucursal_id);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'Pedido inexistente o sin permisos';
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pedido_check_acceso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_check_acceso(uuid) TO authenticated, service_role;

-- ── 1. Lanzar: tareas en la sucursal del LPN ─────────────────────────────────────────────────────────────────────────────
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
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
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
      ORDER BY prio
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
        SELECT il.lpn, il.ubicacion_id, il.sucursal_id, il.cantidad,
               (CASE WHEN COALESCE(il.cantidad_reservada,0) > 0 THEN 3 ELSE 4 END) AS prio
        FROM inventario_lineas il
        WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
          AND il.activo = true AND il.cantidad > 0
          AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
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

-- ── 2. Pedido listo cuando no queda picking pendiente (lo dispare quien lo dispare) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_marcar_listo(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Solo del propio negocio (el que la llama completó una tarea de ese pedido, que puede ser de otra sucursal).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pedidos WHERE id = p_pedido_id AND tenant_id = get_user_tenant_id()) THEN
    RETURN;
  END IF;
  UPDATE pedidos p SET estado = 'listo_para_entrega'
   WHERE p.id = p_pedido_id AND p.estado = 'en_preparacion'
     AND NOT EXISTS (
       SELECT 1 FROM wms_tareas w
       WHERE w.pedido_id = p_pedido_id AND w.tipo = 'picking'
         AND w.estado NOT IN ('completada', 'cancelada'));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_pedido_marcar_listo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_marcar_listo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_completar_tarea_picking(p_tarea_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_tarea RECORD; v_prec RECORD;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Esta tarea no es de picking'; END IF;
  IF v_tarea.estado = 'completada' THEN RETURN; END IF;
  IF v_tarea.estado = 'cancelada' THEN RAISE EXCEPTION 'La tarea está cancelada'; END IF;

  IF v_tarea.tarea_precedente_id IS NOT NULL THEN
    SELECT * INTO v_prec FROM wms_tareas WHERE id = v_tarea.tarea_precedente_id;
    IF v_prec.estado IS DISTINCT FROM 'completada' THEN
      RAISE EXCEPTION 'Todavía falta completar el reabastecimiento previo de esta tarea';
    END IF;
  END IF;

  UPDATE wms_tareas SET estado = 'completada', completed_at = now() WHERE id = p_tarea_id;

  -- (mig 316) Si con ésta se terminó de pickear todo el pedido, pasa a "listo para entrega".
  -- Mig 490: por una función DEFINER — el que completa puede ser de otra sucursal y no ver el pedido ni las demás tareas.
  IF v_tarea.pedido_id IS NOT NULL THEN
    PERFORM fn_pedido_marcar_listo(v_tarea.pedido_id);
  END IF;
END; $function$;

-- ── 3. Deshacer lanzamiento / cancelar: ven TODAS las tareas del pedido ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_liberar_tareas_pendientes(p_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tarea RECORD;
  v_de_venta boolean;
BEGIN
  PERFORM fn_pedido_check_acceso(p_pedido_id);
  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  -- Mig 488: en un pedido que nació de una venta el picking nunca reservó (mig 316): la reserva es de la VENTA.
  SELECT (venta_origen_id IS NOT NULL) INTO v_de_venta FROM pedidos WHERE id = p_pedido_id;

  FOR v_tarea IN
    SELECT * FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado IN ('pendiente', 'en_curso')
  LOOP
    IF v_tarea.lpn_origen IS NOT NULL AND NOT COALESCE(v_de_venta, false) THEN
      UPDATE inventario_lineas SET cantidad_reservada = GREATEST(0, cantidad_reservada - v_tarea.cantidad)
      WHERE tenant_id = v_tarea.tenant_id AND producto_id = v_tarea.producto_id
        AND ubicacion_id = v_tarea.ubicacion_origen_id AND lpn = v_tarea.lpn_origen AND activo = true;
    END IF;
    UPDATE wms_tareas SET estado = 'cancelada',
      notas = COALESCE(notas || ' — ', '') || 'Cancelada: se deshizo el lanzamiento del pedido'
    WHERE id = v_tarea.id;
  END LOOP;
END;
$function$;

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

  PERFORM fn_pedido_liberar_tareas_pendientes(p_pedido_id);

  UPDATE envios SET estado = 'cancelado'
  WHERE pedido_id = p_pedido_id AND venta_id IS NULL AND estado NOT IN ('cancelado', 'entregado');

  UPDATE pedidos SET estado = 'cancelado', cancelado_at = now() WHERE id = p_pedido_id;
END;
$function$;

-- ── 4. Lecturas para la UI ───────────────────────────────────────────────────────────────────────────────────────────────
-- Avance de pedidos: TODAS sus tareas (también las de otra sucursal), solo de pedidos que el usuario puede ver.
CREATE OR REPLACE FUNCTION public.fn_pedido_tareas_detalle(p_pedido_ids uuid[])
RETURNS TABLE (id uuid, pedido_id uuid, tipo text, estado text, producto_id uuid, cantidad numeric, lpn_origen text,
               tarea_precedente_id uuid, sucursal_id uuid, sucursal_nombre text, producto_nombre text, producto_sku text,
               created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT w.id, w.pedido_id, w.tipo, w.estado, w.producto_id, w.cantidad::numeric, w.lpn_origen, w.tarea_precedente_id,
         w.sucursal_id, s.nombre, pr.nombre, pr.sku, w.created_at
    FROM wms_tareas w
    JOIN pedidos p ON p.id = w.pedido_id
    LEFT JOIN sucursales s ON s.id = w.sucursal_id
    LEFT JOIN productos pr ON pr.id = w.producto_id
   WHERE w.pedido_id = ANY (p_pedido_ids)
     AND p.tenant_id = get_user_tenant_id()
     AND (auth_ve_todas_sucursales() OR p.sucursal_id IS NULL OR p.sucursal_id = auth_user_sucursal())
   ORDER BY w.created_at
$$;
REVOKE ALL ON FUNCTION public.fn_pedido_tareas_detalle(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_tareas_detalle(uuid[]) TO authenticated;

-- Datos del pedido de las tareas que el usuario ve (B pickea para un pedido de A: número, estado y a qué sucursal va).
CREATE OR REPLACE FUNCTION public.fn_pedidos_de_mis_tareas(p_pedido_ids uuid[])
RETURNS TABLE (id uuid, numero integer, estado text, venta_origen_id uuid, fecha_entrega_solicitada date,
               sucursal_id uuid, sucursal_nombre text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.numero, p.estado, p.venta_origen_id, p.fecha_entrega_solicitada, p.sucursal_id, s.nombre
    FROM pedidos p
    LEFT JOIN sucursales s ON s.id = p.sucursal_id
   WHERE p.id = ANY (p_pedido_ids)
     AND p.tenant_id = get_user_tenant_id()
     AND EXISTS (
       SELECT 1 FROM wms_tareas w
        WHERE w.pedido_id = p.id
          AND (auth_ve_todas_sucursales() OR w.sucursal_id IS NULL OR w.sucursal_id = auth_user_sucursal()))
$$;
REVOKE ALL ON FUNCTION public.fn_pedidos_de_mis_tareas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedidos_de_mis_tareas(uuid[]) TO authenticated;

-- ── 5. Endurecer: sin usuario solo pasa el service_role / procesos internos, nunca anon ──────────────────────────────────
-- Una función SECURITY DEFINER sin REVOKE explícito queda ejecutable por PUBLIC (incluido anon), y anon no tiene auth.uid().
CREATE OR REPLACE FUNCTION public.fn_venta_reserva_check_acceso(p_tenant_id uuid, p_venta_sucursal uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role (webhooks / EFs) o sin JWT (pg_cron, migraciones): pasa. Cualquier otro rol sin usuario (anon): no.
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
      RAISE EXCEPTION 'Venta inexistente o sin permisos' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN;
  END IF;
  IF p_tenant_id IS DISTINCT FROM get_user_tenant_id() THEN
    RAISE EXCEPTION 'Venta inexistente o sin permisos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (auth_ve_todas_sucursales() OR p_venta_sucursal IS NULL OR p_venta_sucursal = auth_user_sucursal()) THEN
    RAISE EXCEPTION 'Venta inexistente o sin permisos' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pedido_liberar_tareas_pendientes(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pedido_deslanzar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cancelar_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pedido_liberar_tareas_pendientes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pedido_deslanzar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_pedido(uuid) TO authenticated, service_role;
