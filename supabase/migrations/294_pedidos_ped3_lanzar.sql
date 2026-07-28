-- ============================================================
-- 294_pedidos_ped3_lanzar.sql
-- Módulo Pedidos — PED3 ("Lanzar" el Pedido → genera tareas WMS). Ver
-- G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md sección F/H para el diseño
-- completo. Continúa PED1 (mig 292, schema).
--
-- Alcance: RPC `fn_generar_tareas_picking_pedido` (F1) — arranca desde `pedido_items`, NUNCA
-- desde un envío/venta existente (a diferencia de `fn_generar_tareas_picking_envio`, mig
-- 290/291, que sigue existiendo intacta y sigue siendo código muerto en la práctica — F4,
-- Ventas no genera tareas). Reserva stock real en `inventario_lineas.cantidad_reservada`
-- (H4) con el MISMO mecanismo y el MISMO edge-case de paridad que ya tiene "Reservar stock"
-- de Ventas + Fuente 2 de fn_generar_tareas_picking_envio: la reserva se hace sobre la línea
-- FEFO elegida sin importar si está en zona picking o bulk, y si necesita reabastecimiento
-- se encadena una tarea `replenishment` igual que hoy — fn_completar_tarea_reabastecimiento
-- (sin cambios en esta migración) consume por disponibilidad en la ubicación origen, no por
-- LPN puntual, así que en el caso límite de que TODO el stock de una ubicación esté reservado
-- exactamente al límite, podría no encontrar la misma unidad física reservada (mismo
-- comportamiento ya aceptado en Fuente 2 del envío — no es una regresión nueva de Pedidos,
-- ver comentario de cabecera de la mig 291). Validación bloqueante de stock (H2): se calcula
-- el disponible ANTES de reservar nada; si falta, se aborta con RAISE EXCEPTION (rollback
-- automático de toda la función — ninguna línea queda reservada a medias). Envío condicional
-- (F2): si `pedidos.requiere_envio`, se crea un `envios` con `pedido_id` (venta_id NULL hasta
-- que exista la venta real, PED4) usando el domicilio principal del cliente si tiene uno.
--
-- Revisado por el subagente migration-reviewer antes de aplicar — dos hallazgos reales
-- corregidos en esta misma migración:
--   1) 🔴 Filtro por atributo de variante (talle/color/encaje/formato/sabor_aroma): sin esto,
--      un Pedido que pide "talle M" podía terminar reservando/pickeando "talle S" (mismo
--      criterio de `atributoAmbiguoEnStock` en VentasPage.tsx, pero acá no hay un humano en
--      el loop para frenar la ambigüedad — se filtra estricto por el atributo pedido).
--   2) 🟡 Excluir `ubicacion_id IS NULL` y ubicaciones con `disponible_surtido = false`: sin
--      esto, una línea sin ubicar (típico de modo básico/stock legado) podía generar una tarea
--      de reabastecimiento con `ubicacion_origen_id = NULL`, imposible de completar nunca
--      (`fn_completar_tarea_reabastecimiento` compara `il.ubicacion_id = tarea.ubicacion_origen_id`
--      y `NULL = NULL` nunca es verdadero en SQL) — quedaría una reserva stuck para siempre.
-- Hallazgo #2 del review (liberar `cantidad_reservada` al cancelar una tarea/pedido ya
-- lanzado) queda diferido a PED5 (des-pickeo) a propósito — mientras tanto la UI
-- (PedidosPage.tsx) no ofrece "Cancelar" para un pedido con `lanzado_at` seteado.
-- ============================================================

-- ── 1) wms_tareas: origen 'pedido' + FK pedido_id ──────────────────────────────────────
ALTER TABLE wms_tareas
  ADD COLUMN IF NOT EXISTS pedido_id uuid REFERENCES pedidos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wms_tareas_pedido ON wms_tareas (pedido_id);
COMMENT ON COLUMN wms_tareas.pedido_id IS
  'Pedido que originó esta tarea (origen=''pedido'', PED3). Análogo a envio_id pero para el módulo Pedidos.';

ALTER TABLE wms_tareas DROP CONSTRAINT IF EXISTS wms_tareas_origen_check;
ALTER TABLE wms_tareas ADD CONSTRAINT wms_tareas_origen_check
  CHECK (origen IN ('envio','manual','umbral','pedido'));

-- ── 2) fn_generar_tareas_picking_pedido — "Lanzar" (F1) ────────────────────────────────
-- SECURITY INVOKER (mismo criterio que el resto de RPCs de wms_tareas, mig 290): respeta la
-- RLS del caller sobre pedidos/pedido_items/inventario_lineas/wms_tareas/envios.
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido       RECORD;
  v_item         RECORD;
  v_producto     RECORD;
  v_linea        RECORD;
  v_pendiente    numeric;
  v_disponible   numeric;
  v_tomar        numeric;
  v_reab_on      boolean;
  v_ubic_tipo    text;
  v_destino_id   uuid;
  v_reab_id      uuid;
  v_pick_id      uuid;
  v_domicilio_id uuid;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN
    RAISE EXCEPTION 'Pedido inexistente o sin permisos';
  END IF;

  -- Idempotencia: si ya se lanzó (hay tareas generadas), no duplicar — devolver lo existente.
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
    RETURN;
  END IF;

  IF v_pedido.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El pedido está cancelado';
  END IF;
  IF v_pedido.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo';
  END IF;

  SELECT wms_reabastecimiento_on_demand INTO v_reab_on FROM tenants WHERE id = v_pedido.tenant_id;

  -- ── H2: validar TODO el pedido antes de reservar nada (si algo falta, se aborta entero) ──
  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    CONTINUE WHEN v_item.pendiente <= 0;

    SELECT COALESCE(SUM(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
      AND il.activo = true AND il.ubicacion_id IS NOT NULL
      AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
      AND (il.fecha_vencimiento IS NULL OR il.fecha_vencimiento >= CURRENT_DATE)
      AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
      AND (v_item.talle IS NULL OR il.talle = v_item.talle)
      AND (v_item.color IS NULL OR il.color = v_item.color)
      AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
      AND (v_item.formato IS NULL OR il.formato = v_item.formato)
      AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
      AND EXISTS (SELECT 1 FROM ubicaciones u3 WHERE u3.id = il.ubicacion_id AND u3.disponible_surtido IS NOT FALSE)
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0;

    IF v_disponible < v_item.pendiente THEN
      SELECT p.nombre, p.sku INTO v_producto FROM productos p WHERE p.id = v_item.producto_id;
      RAISE EXCEPTION 'No hay stock para % (SKU %) — faltan % unidades',
        v_producto.nombre, v_producto.sku, (v_item.pendiente - v_disponible);
    END IF;
  END LOOP;

  -- ── H4: reservar (misma mecánica que "Reservar stock" de Ventas) + generar tareas ──────
  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    v_pendiente := v_item.pendiente;
    CONTINUE WHEN v_pendiente <= 0;

    FOR v_linea IN
      SELECT il.id, il.cantidad, COALESCE(il.cantidad_reservada,0) AS cantidad_reservada, il.ubicacion_id, il.lpn
      FROM inventario_lineas il
      WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
        AND il.activo = true AND il.ubicacion_id IS NOT NULL
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        AND (il.fecha_vencimiento IS NULL OR il.fecha_vencimiento >= CURRENT_DATE)
        AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
        AND (v_item.talle IS NULL OR il.talle = v_item.talle)
        AND (v_item.color IS NULL OR il.color = v_item.color)
        AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
        AND (v_item.formato IS NULL OR il.formato = v_item.formato)
        AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
        AND EXISTS (SELECT 1 FROM ubicaciones u3 WHERE u3.id = il.ubicacion_id AND u3.disponible_surtido IS NOT FALSE)
        AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE OF il SKIP LOCKED
    LOOP
      EXIT WHEN v_pendiente <= 0;
      v_tomar := LEAST(v_pendiente, v_linea.cantidad - v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      UPDATE inventario_lineas SET cantidad_reservada = cantidad_reservada + v_tomar WHERE id = v_linea.id;

      SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_linea.ubicacion_id;

      IF v_linea.ubicacion_id IS NOT NULL AND v_ubic_tipo = 'picking' THEN
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_linea.lpn, 'pedido', p_pedido_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSIF v_reab_on THEN
        v_destino_id := fn_wms_elegir_ubicacion_picking(v_pedido.tenant_id, v_pedido.sucursal_id, v_item.producto_id);
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'replenishment', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_destino_id, v_linea.lpn, 'pedido', p_pedido_id,
                'Reabastecer ' || fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer) || ' a zona de picking')
        RETURNING id INTO v_reab_id;
        RETURN QUERY SELECT v_reab_id, 'replenishment'::text;

        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, tarea_precedente_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, COALESCE(v_destino_id, v_linea.ubicacion_id), v_linea.lpn, 'pedido', p_pedido_id, v_reab_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSE
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_linea.lpn, 'pedido', p_pedido_id,
                'Ubicación fuera de zona picking — reabastecimiento on-demand deshabilitado')
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;
      END IF;

      v_pendiente := v_pendiente - v_tomar;
    END LOOP;

    IF v_pendiente > 0 THEN
      -- No debería pasar (ya validamos arriba) salvo carrera concurrente entre la validación
      -- y la reserva (otro proceso consumió el mismo stock en el medio) — abortar entero.
      SELECT p.nombre, p.sku INTO v_producto FROM productos p WHERE p.id = v_item.producto_id;
      RAISE EXCEPTION 'No hay stock para % (SKU %) — faltan % unidades (cambió mientras se lanzaba, reintentá)',
        v_producto.nombre, v_producto.sku, v_pendiente;
    END IF;
  END LOOP;

  -- ── F2: envío condicional ────────────────────────────────────────────────────────────
  IF v_pedido.requiere_envio AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = p_pedido_id) THEN
    v_domicilio_id := NULL;
    IF v_pedido.cliente_id IS NOT NULL THEN
      SELECT cd.id INTO v_domicilio_id FROM cliente_domicilios cd
      WHERE cd.cliente_id = v_pedido.cliente_id
      ORDER BY cd.es_principal DESC, cd.created_at
      LIMIT 1;
    END IF;
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, destino_id, canal, estado, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_domicilio_id, 'Pedidos', 'pendiente',
            'Generado automáticamente al lanzar el Pedido #' || v_pedido.numero);
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid() WHERE id = p_pedido_id;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION fn_generar_tareas_picking_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_pedido(uuid) TO authenticated, service_role;
