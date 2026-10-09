-- 493 — No se des-pickea un pedido entregado (total o en parte) ni el de una venta ya despachada (REGLA #0, inventario)
--
-- Reporte de GO 2026-10-09: en un pedido "Entregado" el detalle ofrecía "Deshacer" sobre la tarea de picking completada. La
-- base frenaba entregado/cancelado pero no 'entregado_parcial', ni el pedido de una venta ya despachada/facturada (mig 486):
-- des-pickear crea un LPN nuevo descontando la reserva del LPN de origen, que a esa altura puede ser de OTRA venta. Ahora
-- solo se deshace con el pedido en preparación o listo y la venta sin despachar. Versión base: mig 491.

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
  -- Mig 493: solo con el pedido en preparación o listo (antes se podía en 'entregado_parcial': lo pickeado pudo haberse
  -- entregado) y con la venta de origen todavía sin despachar (despachada/facturada = el stock ya salió: lo que se "devolvía"
  -- salía de la reserva de OTRA venta del mismo LPN).
  IF v_pedido.estado NOT IN ('en_preparacion', 'listo_para_entrega') THEN
    RAISE EXCEPTION 'El pedido está % — ya no se puede deshacer el picking (una devolución va por Ventas → Devolución)',
      replace(v_pedido.estado, '_', ' ');
  END IF;
  IF v_pedido.venta_origen_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM ventas v WHERE v.id = v_pedido.venta_origen_id AND v.estado IN ('despachada', 'facturada')) THEN
    RAISE EXCEPTION 'La venta de este pedido ya se despachó: el stock ya salió y no se puede deshacer el picking';
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
