-- ============================================================
-- 300_pedidos_unpick_encadenado.sql
-- Módulo Pedidos — cierra el gap documentado desde PED5: `fn_unpick_tarea_wms` (mig 296) nunca
-- podía des-pickear una tarea de picking ENCADENADA a un reabastecimiento (el caso más común,
-- dado que `wms_reabastecimiento_on_demand` viene habilitado por default) — la UI ocultaba el
-- botón "Deshacer" para esas tareas.
--
-- Causa raíz (documentada desde la mig 294/296): para una tarea de picking encadenada,
-- `ubicacion_origen_id` = el DESTINO del reabastecimiento (la ubicación de picking), pero
-- `lpn_origen` sigue siendo el texto del LPN de BULK que originó la reserva — ese texto nunca
-- existió físicamente en la ubicación de picking (`fn_completar_tarea_reabastecimiento` genera
-- un LPN nuevo por timestamp al mover el stock). El match exacto `producto+ubicación+lpn` de la
-- versión anterior de `fn_unpick_tarea_wms` daba `NULL` siempre para este caso.
--
-- Fix: si el match exacto (comportamiento sin cambios para picking DIRECTO) no encuentra nada
-- Y la tarea está encadenada (`tarea_precedente_id IS NOT NULL`), se agrega un fallback que
-- busca CUALQUIER línea reservada del mismo producto en esa ubicación (FEFO), consumiendo de
-- una o varias hasta cubrir `tarea.cantidad` — mismo criterio de agregación multi-línea que ya
-- usa `fn_pedido_generar_venta` para el rebaje.
--
-- ⚠ Limitación residual aceptada (misma clase de fungibilidad ya documentada en la mig 294 para
-- Fuente 2 de `fn_generar_tareas_picking_envio`): `wms_tareas` no guarda atributos de variante,
-- así que si hubiera OTRA reserva del mismo producto+sin-distinguir-atributo en la misma
-- ubicación de picking (de otro Pedido/venta), el fallback podría liberar/reubicar esa reserva
-- ajena en vez de la propia. El invariante global (total reservado = total real) se mantiene
-- siempre, pero la trazabilidad fina por reserva-específica puede desalinearse en ese edge case
-- — igual que el resto de los matches "por disponibilidad" del módulo WMS, no es una regresión
-- nueva. Sin este fix, el des-pickeo simplemente NO funcionaba para el caso común; con el fix,
-- funciona correctamente en el caso normal (una sola reserva por producto+ubicación) y de forma
-- best-effort en el edge case de reservas múltiples superpuestas.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_unpick_tarea_wms(p_tarea_id uuid, p_ubicacion_destino_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea      RECORD;
  v_pedido     RECORD;
  v_linea      RECORD;
  v_nuevo_lpn  text;
  v_restante   integer;
  v_tomar      integer;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Solo se puede deshacer (des-pickear) una tarea de picking'; END IF;
  IF v_tarea.estado <> 'completada' THEN RAISE EXCEPTION 'Esta tarea no está completada'; END IF;
  IF v_tarea.pedido_id IS NULL THEN RAISE EXCEPTION 'El des-pickeo solo está disponible para tareas originadas en un Pedido'; END IF;
  IF p_ubicacion_destino_id IS NULL THEN RAISE EXCEPTION 'Elegí una ubicación destino para reubicar el LPN'; END IF;

  SELECT * INTO v_pedido FROM pedidos WHERE id = v_tarea.pedido_id FOR UPDATE;
  IF v_pedido.estado IN ('entregado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido ya está % — no se puede deshacer el picking', v_pedido.estado;
  END IF;

  v_restante := v_tarea.cantidad;

  -- 1) Picking DIRECTO (sin cambios): match exacto por LPN — normalmente una sola fila, dado
  -- que el LPN es único por tenant.
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
    INSERT INTO inventario_lineas
      (tenant_id, producto_id, lpn, cantidad, estado_id, ubicacion_id, sucursal_id, proveedor_id,
       nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
    VALUES
      (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar, v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
       v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma);

    v_restante := v_restante - v_tomar;
  END LOOP;

  -- 2) Fallback SOLO para tareas encadenadas a un reabastecimiento (ver comentario de
  -- cabecera): el lpn_origen es un texto viejo que ya no existe físicamente en esta ubicación
  -- — buscar cualquier línea reservada del mismo producto ahí, FEFO, agregando entre varias si
  -- hace falta.
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
        (tenant_id, producto_id, lpn, cantidad, estado_id, ubicacion_id, sucursal_id, proveedor_id,
         nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
      VALUES
        (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar, v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
         v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma);

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
$$;

REVOKE ALL ON FUNCTION fn_unpick_tarea_wms(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_unpick_tarea_wms(uuid, uuid) TO authenticated, service_role;
