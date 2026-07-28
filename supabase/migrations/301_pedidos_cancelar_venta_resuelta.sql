-- ============================================================
-- 301_pedidos_cancelar_venta_resuelta.sql
-- Módulo Pedidos — cierra parcialmente el gap documentado desde PED5 (A5): `fn_cancelar_pedido`
-- (mig 296) bloqueaba PARA SIEMPRE la cancelación de un pedido que alguna vez generó una venta
-- real, incluso después de que esa venta ya se hubiera DEVUELTO a mano desde Ventas → Historial
-- (el `EXISTS (SELECT 1 FROM ventas WHERE pedido_id = ...)` original no filtraba por estado, así
-- que la fila de la venta —que sigue existiendo con estado 'devuelta'/'cancelada'— la seguía
-- contando como "activa" y el pedido quedaba en un callejón sin salida).
--
-- La devolución automática end-to-end (disparar la devolución completa por código, con NC/CC si
-- corresponde) sigue diferida a propósito — reimplementaría en SQL una lógica fiscal compleja
-- que hoy solo vive, testeada, en `VentasPage.tsx` (Regla de oro #0: un solo lugar calcula
-- plata/emite comprobantes). En cambio, se cierra el flujo real: la UI ahora guía al usuario a
-- devolver la venta desde el link ya existente `/ventas?id=<id>&devolver=1` (mismo patrón que ya
-- usa `EnviosPage.tsx`), y una vez devuelta (o cancelada), `fn_cancelar_pedido` deja de bloquear.
-- ============================================================

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

  -- A5: solo bloquea si hay una venta ACTIVA (no devuelta ni ya cancelada) — una vez que la
  -- venta se devolvió a mano (Ventas → Historial → Devolver), el pedido puede cancelarse.
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
$$;

REVOKE ALL ON FUNCTION fn_cancelar_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_cancelar_pedido(uuid) TO authenticated, service_role;
