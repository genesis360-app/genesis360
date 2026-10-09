-- 492 — Un pedido entregado (total o en parte) no se cancela (REGLA #0, inventario) — reporte de GO 2026-10-09
--
-- El menú de Pedidos ofrecía "Cancelar pedido" en cualquier estado salvo cancelado (también entregado / entregado parcial) y
-- la base solo rechazaba 'entregado': un pedido 'entregado_parcial' se podía cancelar al aprobar la solicitud. Ahora la base
-- rechaza los dos y la pantalla no ofrece la opción. Versión base: mig 491 (sin otros cambios).

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
  -- Mig 492: un pedido ENTREGADO EN PARTE tampoco se cancela (la mercadería entregada es historia; lo pendiente se cierra
  -- con "Cerrar pedido" y una devolución va por Ventas → Devolución).
  IF v_pedido.estado = 'entregado_parcial' THEN
    RAISE EXCEPTION 'El pedido ya se entregó en parte — no se puede cancelar. Para dar por terminado lo pendiente usá "Cerrar pedido"; para devolver mercadería, la devolución de la venta.';
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
