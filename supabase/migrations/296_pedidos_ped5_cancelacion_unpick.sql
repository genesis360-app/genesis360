-- ============================================================
-- 296_pedidos_ped5_cancelacion_unpick.sql
-- Módulo Pedidos — PED5 (cancelación de un Pedido ya lanzado + des-pickeo). Ver
-- G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md secciones E4/F5.
--
-- Hasta PED4, cancelar un Pedido (`PedidosPage.tsx` → `cambiarEstado`) hacía un UPDATE directo
-- a `pedidos.estado`, permitido solo en `borrador`/`confirmado` — antes de "lanzar" (PED3), así
-- que nunca había reservas de stock que liberar. Esta migración agrega:
--
-- 1) `fn_pedido_deslanzar` (F5): deshace el "lanzar" — vuelve el Pedido a `confirmado` y libera
--    todo lo reservado, SOLO si ninguna tarea WMS del pedido está `en_curso`/`completada` (si ya
--    se pickeó algo, hay que des-pickearlo primero, punto 2). Útil para corregir un lanzamiento
--    con datos mal cargados sin tener que cancelar el pedido entero.
-- 2) `fn_cancelar_pedido`: cancelación completa (cualquier estado no terminal), mismo guard de
--    "nada completada" que (1), además cancela el envío auto-generado (F2) si no se despachó.
-- 3) `fn_unpick_tarea_wms` (E4, "des-pickeo"): inversa de `fn_completar_tarea_picking` — para
--    una tarea de picking YA completada (originada en un Pedido), libera la reserva y reubica
--    físicamente el LPN en la ubicación que el operador elija (mismo mecanismo de movimiento que
--    `fn_completar_tarea_reabastecimiento`, pero el LPN nuevo queda SIN reserva — vuelve a ser
--    stock libre). Solo tareas `tipo='picking'` con `pedido_id` seteado; los reabastecimientos ya
--    completados no se deshacen acá (movieron stock real entre ubicaciones, no una reserva extra
--    — ver comentario de cabecera de la mig 289/291).
--
-- Nota de diseño importante: `pedido_items.estado`/`cantidad_entregada` NUNCA se tocan durante
-- el ciclo picking→completar (eso solo pasa en PED4, `fn_pedido_generar_venta`, al entregar de
-- verdad) — por eso deshacer un picking (des-pickeo) no necesita revertir nada en `pedido_items`,
-- solo la reserva de `inventario_lineas` y la propia `wms_tareas`.
--
-- Liberación de reserva por `lpn_origen` (snapshot text, no FK): coincide con el criterio ya
-- usado en toda la mig 294 — se matchea `producto_id + ubicacion_origen_id + lpn_origen` contra
-- `inventario_lineas`. Para una tarea de picking ENCADENADA a un reabastecimiento (mismo lpn_origen
-- que el reabastecimiento pero con `ubicacion_origen_id` = destino del reabastecimiento), el
-- match no encuentra fila (el LPN físico nunca existió ahí con ese texto — se generó uno nuevo al
-- completar el reabastecimiento) y el UPDATE no afecta filas: es un no-op seguro, no un doble
-- release, porque la reserva real solo se incrementó UNA vez (en la tarea de reabastecimiento
-- original) — ver comentario de cabecera de la mig 294 sobre este mismo gap ya aceptado.
--
-- Revisado por el subagente migration-reviewer — 2 hallazgos reales corregidos antes de aplicar:
--   1) 🔴 `fn_cancelar_pedido` no chequeaba si el pedido ya tenía una VENTA REAL generada (PED4,
--      mig 295) — el relevamiento (A5) dice explícito que cancelar un pedido con entrega real
--      "dispara la devolución de la(s) venta(s) asociada(s)". Implementar esa devolución
--      automática es alcance mayor (reusa el flujo de devoluciones de VentasPage.tsx, con
--      NC/CC) — se DIFIERE a una fase posterior. Mientras tanto, `fn_cancelar_pedido` BLOQUEA
--      con `RAISE EXCEPTION` si existe cualquier venta vinculada, en vez de cancelar el pedido
--      dejando la venta real huérfana (que hubiera sido un estado contable/inventario
--      inconsistente). `PedidosPage.tsx` deja de ofrecer "Cancelar" para `entregado_parcial`.
--   2) 🔴 `fn_unpick_tarea_wms` nunca puede des-pickear una tarea de picking ENCADENADA a un
--      reabastecimiento (su `lpn_origen` apunta a un texto que nunca existió en la ubicación
--      destino — ver el comentario de arriba sobre el gap ya aceptado). Es el caso más común
--      (reabastecimiento on-demand viene habilitado por default), así que dejar el mensaje de
--      error genérico sería engañoso. Se agrega un mensaje específico cuando
--      `tarea_precedente_id IS NOT NULL` explicando la limitación, y `PedidosPage.tsx` oculta el
--      botón "Deshacer" para esas tareas encadenadas (solo lo ofrece para picking DIRECTO, sin
--      reabastecimiento de por medio) — arreglar esto de raíz (matchear por producto+ubicación
--      sin depender del texto de lpn_origen) queda como pendiente documentado.
-- Además: `fn_pedido_liberar_tareas_pendientes` ahora toma `FOR UPDATE` sobre TODAS las
-- `wms_tareas` del pedido (no solo pendiente/en_curso) para que el guard "¿hay algo completada?"
-- de cancelar/deslanzar no pueda quedar desactualizado por una tarea que se completa justo en el
-- medio (ventana de carrera), y el UPDATE de liberación agrega `activo = true` por consistencia
-- con el resto del módulo (defensa en profundidad, sin cambio de comportamiento esperado).
-- ============================================================

-- ── Helper interno: bloquea TODAS las tareas del pedido (cierra ventana de carrera con una
-- que se completa justo en el medio), cancela las pendientes/en_curso + libera reservas ──────
CREATE OR REPLACE FUNCTION public.fn_pedido_liberar_tareas_pendientes(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea RECORD;
BEGIN
  -- Lock de TODAS las tareas del pedido primero (incluidas completadas/canceladas) para que el
  -- guard "¿hay alguna completada?" de los callers no quede desactualizado por una que se
  -- completa concurrentemente entre el chequeo y este helper.
  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;

  FOR v_tarea IN
    SELECT * FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado IN ('pendiente', 'en_curso')
  LOOP
    IF v_tarea.lpn_origen IS NOT NULL THEN
      UPDATE inventario_lineas SET cantidad_reservada = GREATEST(0, cantidad_reservada - v_tarea.cantidad)
      WHERE tenant_id = v_tarea.tenant_id AND producto_id = v_tarea.producto_id
        AND ubicacion_id = v_tarea.ubicacion_origen_id AND lpn = v_tarea.lpn_origen AND activo = true;
    END IF;
    UPDATE wms_tareas SET estado = 'cancelada',
      notas = COALESCE(notas || ' — ', '') || 'Cancelada: se deshizo el lanzamiento del pedido'
    WHERE id = v_tarea.id;
  END LOOP;
END;
$$;

-- SECURITY INVOKER (no DEFINER): un authenticated que llame fn_cancelar_pedido/
-- fn_pedido_deslanzar sigue siendo el mismo rol al invocar esto internamente, así que
-- necesita EXECUTE acá también (Postgres chequea el rol invocador en cada llamada, no
-- "hereda" el permiso del caller externo).
REVOKE ALL ON FUNCTION fn_pedido_liberar_tareas_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_liberar_tareas_pendientes(uuid) TO authenticated, service_role;

-- ── 1) fn_pedido_deslanzar (F5) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_deslanzar(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.estado <> 'en_preparacion' THEN
    RAISE EXCEPTION 'Solo se puede deshacer el lanzamiento de un pedido en preparación';
  END IF;

  -- Lock de TODAS las tareas ANTES del guard, para que no quede desactualizado por una que se
  -- completa justo en el medio (ventana de carrera).
  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado = 'completada') THEN
    RAISE EXCEPTION 'Hay una tarea de picking ya completada (o un reabastecimiento completado con un picking encadenado todavía pendiente) — completá o des-pickeá esa tarea antes de deshacer el lanzamiento';
  END IF;

  PERFORM fn_pedido_liberar_tareas_pendientes(p_pedido_id);

  -- El envío auto-generado (F2), si no se despachó, se cancela junto con el lanzamiento.
  UPDATE envios SET estado = 'cancelado'
  WHERE pedido_id = p_pedido_id AND venta_id IS NULL AND estado NOT IN ('cancelado', 'entregado');

  UPDATE pedidos SET estado = 'confirmado', lanzado_at = NULL, lanzado_por = NULL WHERE id = p_pedido_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_pedido_deslanzar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_deslanzar(uuid) TO authenticated, service_role;

-- ── 2) fn_cancelar_pedido — cancelación completa (cualquier estado no terminal) ─────────
CREATE OR REPLACE FUNCTION public.fn_cancelar_pedido(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.estado IN ('cancelado', 'entregado') THEN
    RAISE EXCEPTION 'El pedido ya está % — no se puede cancelar', v_pedido.estado;
  END IF;

  -- A5 (relevamiento): cancelar un pedido con entrega real ya generada debería disparar la
  -- devolución de la(s) venta(s) asociada(s) — implementar esa devolución automática es alcance
  -- mayor (reusa el flujo de devoluciones de VentasPage.tsx, con NC/CC) y queda diferido. Hasta
  -- entonces, BLOQUEAR es más seguro que cancelar el pedido dejando la venta real huérfana.
  IF EXISTS (SELECT 1 FROM ventas WHERE pedido_id = p_pedido_id) THEN
    RAISE EXCEPTION 'Este pedido ya generó una venta real (entrega parcial o total) — para cancelarlo hay que devolver esa venta primero desde Ventas → Historial';
  END IF;

  -- Lock de TODAS las tareas ANTES del guard, para que no quede desactualizado por una que se
  -- completa justo en el medio (ventana de carrera).
  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado = 'completada') THEN
    RAISE EXCEPTION 'Hay una tarea de picking ya completada (o un reabastecimiento completado con un picking encadenado todavía pendiente) — completá o des-pickeá esa tarea antes de cancelar';
  END IF;

  PERFORM fn_pedido_liberar_tareas_pendientes(p_pedido_id);

  UPDATE envios SET estado = 'cancelado'
  WHERE pedido_id = p_pedido_id AND venta_id IS NULL AND estado NOT IN ('cancelado', 'entregado');

  UPDATE pedidos SET estado = 'cancelado', cancelado_at = now() WHERE id = p_pedido_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_cancelar_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_cancelar_pedido(uuid) TO authenticated, service_role;

-- ── 3) fn_unpick_tarea_wms (E4) — des-pickeo con reubicación ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_unpick_tarea_wms(p_tarea_id uuid, p_ubicacion_destino_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea     RECORD;
  v_pedido    RECORD;
  v_linea     RECORD;
  v_nuevo_lpn text;
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

  SELECT il.* INTO v_linea FROM inventario_lineas il
  WHERE il.tenant_id = v_tarea.tenant_id AND il.producto_id = v_tarea.producto_id
    AND il.ubicacion_id = v_tarea.ubicacion_origen_id AND il.lpn = v_tarea.lpn_origen
    AND il.activo = true
  FOR UPDATE;

  IF v_linea IS NULL THEN
    IF v_tarea.tarea_precedente_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta tarea vino de un reabastecimiento — todavía no se puede des-pickear automáticamente (el LPN físico cambió al reabastecer). Contactá soporte para revertirlo a mano.';
    END IF;
    RAISE EXCEPTION 'No se encontró el LPN reservado (%) — puede que ya se haya generado la venta o se haya movido de otra forma', v_tarea.lpn_origen;
  END IF;
  IF v_linea.cantidad_reservada < v_tarea.cantidad THEN
    RAISE EXCEPTION 'La reserva del LPN % ya no coincide con esta tarea — revisar manualmente', v_tarea.lpn_origen;
  END IF;

  -- Inverso de fn_completar_tarea_reabastecimiento: decrementa el origen y crea un LPN nuevo
  -- SIN reserva en el destino (vuelve a ser stock libre — ya no está "apartado" para este pedido).
  UPDATE inventario_lineas
    SET cantidad = cantidad - v_tarea.cantidad,
        cantidad_reservada = cantidad_reservada - v_tarea.cantidad,
        activo = (cantidad - v_tarea.cantidad) > 0
    WHERE id = v_linea.id;

  v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  INSERT INTO inventario_lineas
    (tenant_id, producto_id, lpn, cantidad, estado_id, ubicacion_id, sucursal_id, proveedor_id,
     nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
  VALUES
    (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tarea.cantidad, v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
     v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma);

  UPDATE wms_tareas SET estado = 'cancelada',
    notas = COALESCE(notas || ' — ', '') || 'Des-pickeado: reubicado en otra ubicación'
  WHERE id = p_tarea_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_unpick_tarea_wms(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_unpick_tarea_wms(uuid, uuid) TO authenticated, service_role;
