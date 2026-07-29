-- ============================================================
-- 324_lanzar_pedido_exige_venta_viva.sql
-- Engancha el guard de la mig 323 al punto de entrada de "Lanzar". Va en el DISPATCHER (que es
-- chico) y no dentro del algoritmo de picking: así cubre los dos caminos con una sola línea, sin
-- volver a tocar el cuerpo que mueve stock.
--
-- Cierra el caso que reportó GO: aunque el trigger de la 323 ya cancela el pedido cuando la venta
-- se anula, si por cualquier motivo quedara uno vivo, esto frena el lanzamiento antes de mandar a
-- nadie a buscar mercadería para una venta que no existe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text) LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_venta_origen uuid; v_existe boolean;
BEGIN
  SELECT (p.id IS NOT NULL), p.venta_origen_id INTO v_existe, v_venta_origen
  FROM pedidos p WHERE p.id = p_pedido_id;
  IF NOT COALESCE(v_existe, false) THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  -- (mig 324) No se manda a nadie a buscar mercadería para una venta anulada, devuelta, o que
  -- todavía es un presupuesto. No-op para los pedidos de logística puros.
  PERFORM fn_pedido_venta_viva(p_pedido_id);

  IF v_venta_origen IS NOT NULL THEN
    RETURN QUERY SELECT * FROM fn_generar_tareas_picking_pedido_venta(p_pedido_id);
  ELSE
    RETURN QUERY SELECT * FROM fn_generar_tareas_picking_pedido_stock(p_pedido_id);
  END IF;
  RETURN;
END; $$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido(uuid) IS
  'Punto de entrada único de "Lanzar" (migs 316/324). Valida que la venta esté viva y despacha a _venta (no re-reserva) o a _stock (pedido de logística).';

REVOKE ALL ON FUNCTION fn_generar_tareas_picking_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_pedido(uuid) TO authenticated, service_role;
