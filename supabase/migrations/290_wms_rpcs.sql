-- ============================================================
-- 290_wms_rpcs.sql
-- RPCs del módulo WMS (mig 289). Las 4 funciones son SECURITY INVOKER: respetan la RLS
-- del caller (mismo criterio que fn_estructura_guardar_niveles, mig 282) — el WITH CHECK
-- de wms_tareas es tenant-only, así que cualquier usuario autenticado del tenant puede
-- generar/completar tareas de cualquier sucursal que pueda LEER (auth_ve_todas_sucursales
-- o su propia sucursal), igual que ya pasa con traslados.
--
-- REGLA #0: ninguna de estas funciones toca `venta_items`, `ventas` ni decide qué LPN
-- vende una venta — solo leen esa decisión ya tomada (venta_item_despachos / lpn_plan) y
-- mueven stock DENTRO del depósito (bulk→picking) con la misma operación de
-- LpnAccionesModal → Mover (decrementar origen, insertar nuevo LPN en destino).
-- ============================================================

-- ── Helper: mejor ubicación tipo 'picking' para un producto en una sucursal ────────────
-- Preferencia: una que YA tenga stock de ese producto > la primera picking activa de la
-- sucursal > NULL si no hay ninguna configurada (no bloquea, el picking se genera igual
-- apuntando a la ubicación de origen real).
CREATE OR REPLACE FUNCTION public.fn_wms_elegir_ubicacion_picking(
  p_tenant_id   uuid,
  p_sucursal_id uuid,
  p_producto_id uuid
)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.id FROM ubicaciones u
  WHERE u.tenant_id = p_tenant_id
    AND u.activo = true
    AND u.tipo_ubicacion = 'picking'
    AND (u.sucursal_id IS NULL OR u.sucursal_id = p_sucursal_id)
  ORDER BY
    (EXISTS (
      SELECT 1 FROM inventario_lineas il
      WHERE il.ubicacion_id = u.id AND il.producto_id = p_producto_id AND il.activo = true
    )) DESC,
    u.secuencia NULLS LAST,
    u.prioridad
  LIMIT 1
$$;

-- ── Helper: describe la cantidad en la UdM más grande posible (solo para `notas`,
-- puramente informativo — la columna `cantidad` de wms_tareas SIEMPRE es unidades base) ─
CREATE OR REPLACE FUNCTION public.fn_wms_describir_cantidad(
  p_producto_id uuid,
  p_cantidad_base integer
)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_nivel RECORD;
BEGIN
  SELECT n.unidades_base, um.nombre INTO v_nivel
  FROM producto_estructuras pe
  JOIN producto_estructura_niveles n ON n.estructura_id = pe.id
  JOIN unidades_medida um ON um.id = n.unidad_medida_id
  WHERE pe.producto_id = p_producto_id AND pe.is_default = true
    AND n.unidades_base > 1
    AND p_cantidad_base % n.unidades_base = 0
  ORDER BY n.unidades_base DESC
  LIMIT 1;

  IF v_nivel.unidades_base IS NOT NULL THEN
    RETURN (p_cantidad_base / v_nivel.unidades_base) || ' ' || v_nivel.nombre || ' (' || p_cantidad_base || ' u. base)';
  END IF;
  RETURN p_cantidad_base || ' unidades base';
END;
$$;

-- ── 1) Generar tareas de picking (+ reabastecimiento encadenado) para un envío ─────────
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_envio(p_envio_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_envio       RECORD;
  v_item        RECORD;
  v_despacho    RECORD;
  v_plan_item   jsonb;
  v_ubic_tipo   text;
  v_destino_id  uuid;
  v_reab_on     boolean;
  v_reab_id     uuid;
  v_pick_id     uuid;
  v_tiene_filas boolean;
BEGIN
  SELECT * INTO v_envio FROM envios WHERE id = p_envio_id;
  IF v_envio IS NULL THEN
    RAISE EXCEPTION 'Envío inexistente o sin permisos';
  END IF;
  IF v_envio.venta_id IS NULL THEN
    RAISE EXCEPTION 'El envío no tiene una venta asociada — no hay LPN que picking pueda seguir';
  END IF;

  SELECT wms_reabastecimiento_on_demand INTO v_reab_on FROM tenants WHERE id = v_envio.tenant_id;

  -- Idempotencia: si ya se generaron tareas para este envío, no duplicar.
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE envio_id = p_envio_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.envio_id = p_envio_id;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT vi.id, vi.producto_id, vi.cantidad, vi.lpn_plan
    FROM venta_items vi WHERE vi.venta_id = v_envio.venta_id
  LOOP
    v_tiene_filas := false;

    -- Fuente 1: venta_item_despachos (venta ya despachada — consumo real ya decidido)
    FOR v_despacho IN
      SELECT vid.lpn, vid.ubicacion_id, vid.cantidad
      FROM venta_item_despachos vid
      WHERE vid.venta_item_id = v_item.id
    LOOP
      v_tiene_filas := true;
      SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_despacho.ubicacion_id;

      IF v_despacho.ubicacion_id IS NOT NULL AND v_ubic_tipo = 'picking' THEN
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
        VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_despacho.cantidad, v_despacho.ubicacion_id, v_despacho.lpn, 'envio', p_envio_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_despacho.cantidad::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSIF v_reab_on THEN
        v_destino_id := fn_wms_elegir_ubicacion_picking(v_envio.tenant_id, v_envio.sucursal_id, v_item.producto_id);
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, lpn_origen, origen, envio_id, notas)
        VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'replenishment', v_item.producto_id, v_despacho.cantidad, v_despacho.ubicacion_id, v_destino_id, v_despacho.lpn, 'envio', p_envio_id,
                'Reabastecer ' || fn_wms_describir_cantidad(v_item.producto_id, v_despacho.cantidad::integer) || ' a zona de picking')
        RETURNING id INTO v_reab_id;
        RETURN QUERY SELECT v_reab_id, 'replenishment'::text;

        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, tarea_precedente_id, notas)
        VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_despacho.cantidad, COALESCE(v_destino_id, v_despacho.ubicacion_id), v_despacho.lpn, 'envio', p_envio_id, v_reab_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_despacho.cantidad::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSE
        -- Reabastecimiento on-demand deshabilitado: picking directo a la ubicación real (aunque no sea picking)
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
        VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_despacho.cantidad, v_despacho.ubicacion_id, v_despacho.lpn, 'envio', p_envio_id,
                'Ubicación fuera de zona picking — reabastecimiento on-demand deshabilitado')
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;
      END IF;
    END LOOP;

    -- Fuente 2 (fallback): venta todavía no despachada — usa el plan (mig 156)
    IF NOT v_tiene_filas AND v_item.lpn_plan IS NOT NULL THEN
      FOR v_plan_item IN SELECT * FROM jsonb_array_elements(v_item.lpn_plan)
      LOOP
        DECLARE
          v_linea_id  uuid := NULLIF(v_plan_item->>'linea_id','')::uuid;
          v_lpn_txt   text := v_plan_item->>'lpn';
          v_cant_plan integer := ROUND((v_plan_item->>'cantidad')::numeric);
          v_ubic_id   uuid;
        BEGIN
          IF v_linea_id IS NULL OR v_cant_plan IS NULL OR v_cant_plan <= 0 THEN CONTINUE; END IF;
          SELECT il.ubicacion_id, u.tipo_ubicacion INTO v_ubic_id, v_ubic_tipo
          FROM inventario_lineas il LEFT JOIN ubicaciones u ON u.id = il.ubicacion_id
          WHERE il.id = v_linea_id;

          IF v_ubic_id IS NOT NULL AND v_ubic_tipo = 'picking' THEN
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, v_ubic_id, v_lpn_txt, 'envio', p_envio_id,
                    fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' (reserva pendiente de despacho)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;

          ELSIF v_reab_on THEN
            v_destino_id := fn_wms_elegir_ubicacion_picking(v_envio.tenant_id, v_envio.sucursal_id, v_item.producto_id);
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'replenishment', v_item.producto_id, v_cant_plan, v_ubic_id, v_destino_id, v_lpn_txt, 'envio', p_envio_id,
                    'Reabastecer ' || fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' a zona de picking (reserva pendiente)')
            RETURNING id INTO v_reab_id;
            RETURN QUERY SELECT v_reab_id, 'replenishment'::text;

            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, tarea_precedente_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, COALESCE(v_destino_id, v_ubic_id), v_lpn_txt, 'envio', p_envio_id, v_reab_id,
                    fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' (reserva pendiente de despacho)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;
          ELSE
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, v_ubic_id, v_lpn_txt, 'envio', p_envio_id,
                    'Ubicación fuera de zona picking — reabastecimiento on-demand deshabilitado (reserva pendiente)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;
          END IF;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION fn_wms_describir_cantidad(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_wms_describir_cantidad(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION fn_generar_tareas_picking_envio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_envio(uuid) TO authenticated, service_role;

-- ── 2) Completar tarea de reabastecimiento — mueve stock DE VERDAD (bulk → picking) ────
-- Misma operación que LpnAccionesModal → tab Mover (mismo tenant/sucursal): decrementa
-- el/los LPN origen y crea LPN nuevo en destino. Puede consumir de más de un LPN origen
-- si uno solo no alcanza (recorre por prioridad/vencimiento, igual criterio que rebajeSort
-- para FEFO/FIFO, sin necesitar la regla del producto — es una reubicación, no una venta).
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

    UPDATE inventario_lineas SET cantidad = cantidad - v_tomar WHERE id = v_origen.id;

    v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    INSERT INTO inventario_lineas
      (tenant_id, producto_id, lpn, cantidad, estado_id, ubicacion_id, sucursal_id, proveedor_id,
       nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
    VALUES
      (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar, v_origen.estado_id, v_tarea.ubicacion_destino_id, v_tarea.sucursal_id, v_origen.proveedor_id,
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

-- ── 3) Completar tarea de picking — SOLO bookkeeping, nunca toca inventario_lineas ─────
CREATE OR REPLACE FUNCTION public.fn_completar_tarea_picking(p_tarea_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea RECORD;
  v_prec  RECORD;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Esta tarea no es de picking'; END IF;
  IF v_tarea.estado = 'completada' THEN RETURN; END IF;
  IF v_tarea.estado = 'cancelada' THEN RAISE EXCEPTION 'La tarea está cancelada'; END IF;

  IF v_tarea.tarea_precedente_id IS NOT NULL THEN
    SELECT * INTO v_prec FROM wms_tareas WHERE id = v_tarea.tarea_precedente_id;
    IF v_prec.estado IS DISTINCT FROM 'completada' THEN
      RAISE EXCEPTION 'Todavía falta completar el reabastecimiento previo de esta tarea';
    END IF;
  END IF;

  UPDATE wms_tareas SET estado = 'completada', completed_at = now() WHERE id = p_tarea_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_completar_tarea_picking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_completar_tarea_picking(uuid) TO authenticated, service_role;

-- ── 4) Generar tareas de reabastecimiento por umbral (on-demand, sin pg_cron) ──────────
-- Se llama al abrir la pantalla de tareas WMS (mismo patrón "Procesar ahora" de Aging
-- Profiles). No-op si tenants.wms_reabastecimiento_umbral = false.
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_reabastecimiento_umbral(p_tenant_id uuid)
RETURNS TABLE (tarea_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_habilitado boolean;
  v_umbral     RECORD;
  v_stock      integer;
  v_origen_id  uuid;
  v_cantidad   integer;
  v_nueva_id   uuid;
BEGIN
  SELECT wms_reabastecimiento_umbral INTO v_habilitado FROM tenants WHERE id = p_tenant_id;
  IF NOT COALESCE(v_habilitado, false) THEN RETURN; END IF;

  FOR v_umbral IN
    SELECT pu.producto_id, pu.ubicacion_id, pu.stock_minimo, pu.stock_maximo, u.sucursal_id
    FROM producto_ubicacion_umbrales pu
    JOIN ubicaciones u ON u.id = pu.ubicacion_id
    WHERE pu.tenant_id = p_tenant_id
  LOOP
    SELECT COALESCE(SUM(il.cantidad), 0) INTO v_stock
    FROM inventario_lineas il
    WHERE il.producto_id = v_umbral.producto_id AND il.ubicacion_id = v_umbral.ubicacion_id AND il.activo = true;

    CONTINUE WHEN v_stock >= v_umbral.stock_minimo;

    -- Ya hay una tarea de reabastecimiento pendiente para esta combinación → no duplicar
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM wms_tareas wt
      WHERE wt.tenant_id = p_tenant_id AND wt.tipo = 'replenishment' AND wt.origen = 'umbral'
        AND wt.producto_id = v_umbral.producto_id AND wt.ubicacion_destino_id = v_umbral.ubicacion_id
        AND wt.estado IN ('pendiente','en_curso')
    );

    v_cantidad := COALESCE(v_umbral.stock_maximo, v_umbral.stock_minimo) - v_stock;
    CONTINUE WHEN v_cantidad <= 0;

    SELECT il.ubicacion_id INTO v_origen_id
    FROM inventario_lineas il
    JOIN ubicaciones u2 ON u2.id = il.ubicacion_id
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_umbral.producto_id AND il.activo = true
      AND u2.tipo_ubicacion IN ('bulk','estiba','camara')
      AND il.ubicacion_id <> v_umbral.ubicacion_id
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
    ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
    LIMIT 1;

    CONTINUE WHEN v_origen_id IS NULL; -- no hay de dónde reponer, no se genera una tarea imposible

    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, origen, notas)
    VALUES (p_tenant_id, v_umbral.sucursal_id, 'replenishment', v_umbral.producto_id, v_cantidad, v_origen_id, v_umbral.ubicacion_id, 'umbral',
            'Por debajo del mínimo configurado (' || v_umbral.stock_minimo || ') — ' || fn_wms_describir_cantidad(v_umbral.producto_id, v_cantidad))
    RETURNING id INTO v_nueva_id;

    RETURN QUERY SELECT v_nueva_id;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION fn_generar_tareas_reabastecimiento_umbral(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_reabastecimiento_umbral(uuid) TO authenticated, service_role;
