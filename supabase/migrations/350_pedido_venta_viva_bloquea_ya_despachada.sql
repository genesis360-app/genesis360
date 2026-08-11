-- ============================================================
-- 350_pedido_venta_viva_bloquea_ya_despachada.sql
-- 🛑 REGLA #0 (inventario) — cierra el hueco de rebaje por 2 caminos que encontró GO con la
-- venta real #619 del tenant "Almacén Jorgito" en DEV.
--
-- `fn_pedido_venta_viva` (mig 323) ya frena LANZAR un pedido si la venta es un presupuesto o está
-- anulada/devuelta, pero NO frenaba si la venta ya estaba 'despachada'/'facturada'. Hoy el ÚNICO
-- camino que rebaja stock directo es el botón "Finalizar (rebaja stock)" de Ventas — si alguien lo
-- usa mientras el Pedido de esa misma venta sigue vivo, y después alguien lanza ese Pedido, se
-- generan tareas de picking para volver a preparar/rebajar mercadería que YA salió. Se confirmó con
-- datos reales: la venta #619 llegó a tener el pedido lanzado (tarea de picking real generada)
-- DESPUÉS de que la venta ya estaba 'despachada' — no hubo doble rebaje solo porque esa tarea se
-- canceló antes de completarse, pero el sistema lo permitía.
--
-- El frontend (VentasPage.tsx) ahora oculta el botón "Finalizar (rebaja stock)" cuando la venta
-- tiene un Pedido vivo (no cancelado) — pero la UI se cachea/bypassea, así que esto agrega el
-- guard server-side que exige la Regla de Oro #0. Único cambio real: dos nuevos IF, resto de la
-- función idéntico a la mig 323.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pedido_venta_viva(p_pedido_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_estado text; v_num integer;
BEGIN
  SELECT v.estado, v.numero INTO v_estado, v_num
  FROM pedidos p JOIN ventas v ON v.id = p.venta_origen_id
  WHERE p.id = p_pedido_id;
  IF v_estado IS NULL THEN RETURN; END IF;   -- pedido de logística puro: no aplica
  IF v_estado IN ('cancelada', 'devuelta') THEN
    RAISE EXCEPTION 'La venta #% de este pedido está %: no se puede preparar mercadería para una venta que ya no existe.', v_num, v_estado;
  END IF;
  IF v_estado = 'pendiente' THEN
    RAISE EXCEPTION 'La venta #% todavía es un PRESUPUESTO: confirmala (reserva o despacho) antes de mandar a preparar la mercadería.', v_num;
  END IF;
  IF v_estado IN ('despachada', 'facturada') THEN
    RAISE EXCEPTION 'La venta #% ya fue despachada (el stock ya se rebajó desde Ventas): no se puede lanzar picking para volver a preparar/rebajar la misma mercadería.', v_num;
  END IF;
END; $$;
COMMENT ON FUNCTION public.fn_pedido_venta_viva(uuid) IS
  'Frena el lanzamiento de un pedido cuya venta está anulada, devuelta, todavía es un presupuesto, o YA fue despachada/facturada (rebaje por un solo camino, mig 323 + 350).';
