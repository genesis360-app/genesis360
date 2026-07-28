-- ============================================================
-- 297_wms_reabastecimiento_transferir_reserva.sql
-- Fix de integridad de inventario (REGLA #0) encontrado por el migration-reviewer al revisar
-- PED4 (mig 295, "generar la venta real de un Pedido"): `fn_completar_tarea_reabastecimiento`
-- (mig 290) mueve stock físico de una ubicación bulk a una de picking, pero NUNCA transfería
-- `inventario_lineas.cantidad_reservada` del LPN de origen al LPN nuevo del destino.
--
-- Consecuencia real: un Pedido (mig 294) o una venta reservada (Ventas, "Reservar stock") que
-- reserva stock en una ubicación bulk, y esa ubicación necesita reabastecerse hacia picking
-- (`fn_generar_tareas_picking_pedido`/`fn_generar_tareas_picking_envio`, Fuente 2), deja la
-- reserva "pegada" en el LPN de origen (que después del movimiento puede tener MENOS stock
-- físico del que la reserva sugiere, o directamente 0), mientras el LPN nuevo creado en la
-- ubicación de picking —adonde SÍ llegó el stock físico real— queda completamente SIN reserva
-- (`cantidad_reservada = 0` por default del INSERT). Cualquier proceso que después busque
-- "¿qué está reservado para esto?" filtrando `cantidad_reservada > 0` (como
-- `fn_pedido_generar_venta`, mig 295, o el propio despacho-desde-reserva de VentasPage) puede:
-- (a) no encontrar el LPN correcto (el de picking, recién llegado, sin reserva) y fallar con
-- "no hay stock reservado suficiente", o (b) consumir la reserva equivocada en otro lado,
-- dejando el LPN de picking como "stock fantasma" libre para que se le venda a cualquier otro
-- cliente/pedido sin que nadie lo haya autorizado.
--
-- Fix: al mover `v_tomar` unidades de una línea de origen a una nueva línea de destino, se
-- transfiere PROPORCIONALMENTE la reserva que esa línea de origen tuviera
-- (`LEAST(v_tomar, origen.cantidad_reservada)`) — se resta del origen y se asigna como
-- `cantidad_reservada` inicial del LPN nuevo. Es un fix general, no específico de Pedidos: para
-- reabastecimientos SIN ninguna reserva de por medio (ej. `origen='umbral'`, proactivo, nadie
-- reservó nada todavía) el monto transferido da 0 naturalmente — sin cambio de comportamiento
-- para ese caso. Aplicar ANTES de probar en DEV el camino "Pedido con reabastecimiento → entrega".
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_completar_tarea_reabastecimiento(p_tarea_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea       RECORD;
  v_restante    integer;
  v_origen      RECORD;
  v_tomar       integer;
  v_transferir  integer;
  v_nuevo_lpn   text;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'replenishment' THEN RAISE EXCEPTION 'Esta tarea no es de reabastecimiento'; END IF;
  IF v_tarea.estado = 'completada' THEN RETURN; END IF;
  IF v_tarea.estado = 'cancelada' THEN RAISE EXCEPTION 'La tarea está cancelada'; END IF;
  IF v_tarea.ubicacion_destino_id IS NULL THEN
    RAISE EXCEPTION 'La tarea no tiene ubicación de picking destino configurada — asigná una zona de picking en Configuración → Zonas antes de completarla';
  END IF;

  v_restante := v_tarea.cantidad;

  FOR v_origen IN
    SELECT il.id, il.cantidad, COALESCE(il.cantidad_reservada,0) AS cantidad_reservada, il.estado_id, il.nro_lote,
           il.fecha_vencimiento, il.pais_origen, il.proveedor_id, il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
    FROM inventario_lineas il
    WHERE il.tenant_id = v_tarea.tenant_id
      AND il.producto_id = v_tarea.producto_id
      AND il.ubicacion_id = v_tarea.ubicacion_origen_id
      AND il.activo = true
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
    ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
    FOR UPDATE OF il SKIP LOCKED
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tomar := LEAST(v_restante, v_origen.cantidad - v_origen.cantidad_reservada);
    IF v_tomar <= 0 THEN CONTINUE; END IF;

    -- Transferir la reserva (si la hay) junto con el stock físico — ver comentario de
    -- cabecera. Para líneas sin ninguna reserva (caso típico de 'umbral') da 0, sin cambios.
    v_transferir := LEAST(v_tomar, v_origen.cantidad_reservada);

    UPDATE inventario_lineas
      SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_transferir
      WHERE id = v_origen.id;

    v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    INSERT INTO inventario_lineas
      (tenant_id, producto_id, lpn, cantidad, cantidad_reservada, estado_id, ubicacion_id, sucursal_id, proveedor_id,
       nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
    VALUES
      (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar, v_transferir, v_origen.estado_id, v_tarea.ubicacion_destino_id, v_tarea.sucursal_id, v_origen.proveedor_id,
       v_origen.nro_lote, v_origen.fecha_vencimiento, v_origen.pais_origen, v_origen.talle, v_origen.color, v_origen.encaje, v_origen.formato, v_origen.sabor_aroma);

    v_restante := v_restante - v_tomar;
  END LOOP;

  IF v_restante > 0 THEN
    RAISE EXCEPTION 'No hay stock suficiente en la ubicación de origen para reabastecer (faltan % unidades base)', v_restante;
  END IF;

  UPDATE wms_tareas SET estado = 'completada', completed_at = now() WHERE id = p_tarea_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_completar_tarea_reabastecimiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_completar_tarea_reabastecimiento(uuid) TO authenticated, service_role;
