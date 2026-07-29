-- ============================================================
-- 320_picking_pedido_venta_fuentes_en_cascada.sql
-- 🐛 Bug encontrado por GO probando el flujo real (venta #448, una RESERVA): la tarea de picking
-- salía **sin LPN y sin ubicación** — "no sabe de dónde ir a sacar el inventario".
--
-- Causa: `fn_generar_tareas_picking_pedido_venta` (migs 316/318) leía SOLO `venta_item_despachos`.
-- Esa tabla se escribe al **despachar** (ISS-075), así que una venta **reservada** todavía no tiene
-- ninguna fila ahí — su plan de LPN vive en `venta_items.lpn_plan` (mig 156), que es donde el POS
-- guarda el LPN elegido (incluida la elección MANUAL del cajero). Y como el pedido nace justamente
-- de reservas, el caso más común caía SIEMPRE al fallback "sin desglose por LPN".
-- Verificado en los datos de la venta #448: `despachos = 0`,
-- `lpn_plan = [{"lpn":"LPN-20260619-24B551","linea_id":"64f76de8-…","cantidad":1}]`.
--
-- Se reemplaza por una CASCADA de fuentes, de la más precisa a la más genérica. **Ninguna reserva
-- stock**: la venta ya lo comprometió (ver mig 316 — reservar de nuevo es doble reserva).
--
--   1. `venta_item_despachos` — la venta ya despachó: registro definitivo de qué salió y de dónde.
--   2. `venta_items.lpn_plan`  — la venta está reservada: el LPN que YA eligió el POS. La ubicación
--      se resuelve desde la línea (`linea_id`).
--   3. Líneas con `cantidad_reservada > 0` del producto — hay reserva pero sin plan (venta vieja, o
--      el plan quedó corto). FEFO, solo lectura.
--   4. Cualquier línea con stock — último recurso, para no dejar al operario sin una pista.
--
-- Recién si NADA de eso encuentra algo se emite la tarea sin ubicación, y las notas lo dicen
-- explícitamente ("⚠ sin stock ubicado para este producto") en vez de salir en blanco.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido_venta(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD; v_item RECORD; v_fuente RECORD; v_pick_id uuid;
  v_ubic_tipo text; v_domicilio_id uuid; v_pendiente numeric; v_hubo boolean;
BEGIN
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

    -- ── Fuentes 1 y 2: lo que la venta YA decidió ─────────────────────────────────────
    FOR v_fuente IN
      SELECT vid.lpn, vid.ubicacion_id, SUM(vid.cantidad) AS cantidad, 1 AS prio
      FROM venta_item_despachos vid
      WHERE vid.venta_id = v_pedido.venta_origen_id AND vid.producto_id = v_item.producto_id
        AND vid.cantidad > 0
      GROUP BY vid.lpn, vid.ubicacion_id
      UNION ALL
      -- El plan de LPN de la RESERVA (mig 156). Solo si no hay despachos: si los hay, mandan ellos.
      SELECT il.lpn, il.ubicacion_id, SUM((p->>'cantidad')::numeric) AS cantidad, 2 AS prio
      FROM venta_items vi
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vi.lpn_plan, '[]'::jsonb)) p
      JOIN inventario_lineas il ON il.id = (p->>'linea_id')::uuid
      WHERE vi.venta_id = v_pedido.venta_origen_id AND vi.producto_id = v_item.producto_id
        AND NOT EXISTS (SELECT 1 FROM venta_item_despachos d
                        WHERE d.venta_id = v_pedido.venta_origen_id AND d.producto_id = v_item.producto_id)
        AND (p->>'cantidad')::numeric > 0
      GROUP BY il.lpn, il.ubicacion_id
      ORDER BY prio
    LOOP
      EXIT WHEN v_pendiente <= 0;
      SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                              ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id,
              LEAST(v_fuente.cantidad, v_pendiente), v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_item.producto_id, LEAST(v_fuente.cantidad, v_pendiente)::integer)
                || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' — fuera de zona de picking' ELSE '' END)
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
      v_pendiente := v_pendiente - LEAST(v_fuente.cantidad, v_pendiente);
      v_hubo := true;
    END LOOP;

    -- ── Fuentes 3 y 4: la venta no dejó rastro de LPN → se busca dónde está el stock ───
    -- SOLO LECTURA: se sugiere dónde ir, no se reserva nada. Primero lo que la venta tiene
    -- reservado (es lo más probable que sea "su" mercadería), después cualquier línea con stock.
    IF v_pendiente > 0 THEN
      FOR v_fuente IN
        SELECT il.lpn, il.ubicacion_id, il.cantidad,
               (CASE WHEN COALESCE(il.cantidad_reservada,0) > 0 THEN 3 ELSE 4 END) AS prio
        FROM inventario_lineas il
        WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
          AND il.activo = true AND il.cantidad > 0
          AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        ORDER BY prio, il.fecha_vencimiento NULLS LAST, il.created_at
      LOOP
        EXIT WHEN v_pendiente <= 0;
        SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                                ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id,
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

    -- Ni stock hay: se emite igual (el pedido no puede quedarse sin tarea) diciendo POR QUÉ.
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

  -- Envío condicional (mig 318): se salta si la venta ya tiene uno creado por VentasPage.
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
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) IS
  'Picking de un pedido nacido de una venta (migs 316/318/320). Cascada de fuentes: despachos → lpn_plan de la reserva → líneas reservadas (FEFO) → cualquier línea con stock. NUNCA reserva: la venta ya comprometió el stock.';
