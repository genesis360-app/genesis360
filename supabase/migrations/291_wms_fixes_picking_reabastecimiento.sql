-- ============================================================
-- 291_wms_fixes_picking_reabastecimiento.sql
-- Fixes encontrados en la primera pasada de pruebas manuales de v1.143.0 (GO, DEV,
-- 2026-07-22, tenant Almacén Jorgito — venta #395 / envío #44):
--
-- 1) fn_generar_tareas_picking_envio: la Fuente 1 (venta_item_despachos, venta YA
--    despachada) encadenaba un reabastecimiento igual que la Fuente 2 (reserva pendiente).
--    Para una venta ya despachada el rebaje REAL ya ocurrió y el LPN que la cumple ya quedó
--    fijado en el ledger (venta_item_despachos) — reubicarlo crea un LPN nuevo desvinculado
--    de ese ledger (rompe trazabilidad por unidad) sin aportar nada a la contabilidad (el
--    movimiento es neto cero). Confirmado con datos reales: stock_actual quedaba correcto
--    (114 = 115 − 1 vendida) pero la tarea de picking apuntaba a un lpn_origen que ya no
--    estaba en la ubicación destino (se había creado un LPN nuevo ahí). Fix: Fuente 1 nunca
--    encadena reabastecimiento — genera directo la tarea de picking apuntando al LPN/
--    ubicación real que la venta ya usó, sea o no zona de picking. Fuente 2 (reserva
--    pendiente, todavía nada se consumió) sigue encadenando reabastecimiento sin cambios —
--    ahí sí tiene sentido preparar stock a futuro.
--
-- 2) fn_generar_tareas_reabastecimiento_umbral: generaba la tarea pidiendo SIEMPRE
--    stock_maximo − stock_actual, sin chequear cuánto había realmente disponible en el
--    origen elegido → si el origen no alcanzaba, fn_completar_tarea_reabastecimiento
--    fallaba con "no hay stock suficiente" (confirmado por GO). El máximo es un TECHO, no
--    una obligación: si hay menos stock que lo necesario para llegarlo, hay que reponer lo
--    que haya y listo. Fix: clampear la cantidad al disponible real en la ubicación origen
--    elegida antes de insertar la tarea.
--
-- 3) fn_cancelar_tarea_wms — no existía ninguna forma de cancelar una tarea de picking o
--    reabastecimiento generada por error o que ya no aplica (confirmado por GO). Si se
--    cancela un reabastecimiento que tiene una tarea de picking encadenada todavía
--    pendiente, esa tarea de picking apunta a una ubicación destino que ya no va a recibir
--    stock — se cancela en cascada.
-- ============================================================

-- ── 1) Fuente 1 (venta ya despachada) nunca encadena reabastecimiento ──────────────────
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

    -- Fuente 1: venta_item_despachos (venta ya despachada — consumo REAL ya ocurrió y quedó
    -- fijado en el ledger). Siempre picking directo, NUNCA reabastecimiento — ver comentario
    -- de cabecera de esta migración.
    FOR v_despacho IN
      SELECT vid.lpn, vid.ubicacion_id, vid.cantidad
      FROM venta_item_despachos vid
      WHERE vid.venta_item_id = v_item.id
    LOOP
      v_tiene_filas := true;
      SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_despacho.ubicacion_id;

      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
      VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_despacho.cantidad, v_despacho.ubicacion_id, v_despacho.lpn, 'envio', p_envio_id,
              fn_wms_describir_cantidad(v_item.producto_id, v_despacho.cantidad::integer) ||
              (CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' (fuera de zona de picking — retirar igual, ya está vendido)' ELSE '' END))
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END LOOP;

    -- Fuente 2 (fallback): venta todavía no despachada — usa el plan (mig 156). Acá nada se
    -- consumió todavía, así que encadenar reabastecimiento para preparar el stock en zona de
    -- picking antes del retiro sigue siendo válido — sin cambios respecto a la mig 290.
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

-- ── 2) Umbral: clampear al disponible real en el origen, el máximo es un techo ─────────
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
  v_disponible integer;
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

    -- El máximo es un TECHO, no una obligación: si el origen elegido no tiene tanto
    -- disponible, reponemos lo que haya y listo (no falla al completar la tarea).
    SELECT COALESCE(SUM(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_umbral.producto_id
      AND il.ubicacion_id = v_origen_id AND il.activo = true;

    v_cantidad := LEAST(v_cantidad, v_disponible);
    CONTINUE WHEN v_cantidad <= 0;

    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, origen, notas)
    VALUES (p_tenant_id, v_umbral.sucursal_id, 'replenishment', v_umbral.producto_id, v_cantidad, v_origen_id, v_umbral.ubicacion_id, 'umbral',
            'Por debajo del mínimo configurado (' || v_umbral.stock_minimo || ') — ' || fn_wms_describir_cantidad(v_umbral.producto_id, v_cantidad))
    RETURNING id INTO v_nueva_id;

    RETURN QUERY SELECT v_nueva_id;
  END LOOP;

  RETURN;
END;
$$;

-- ── 3) Cancelar tarea WMS — no existía ninguna forma de hacerlo ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancelar_tarea_wms(p_tarea_id uuid, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea RECORD;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.estado = 'completada' THEN RAISE EXCEPTION 'No se puede cancelar una tarea ya completada'; END IF;
  IF v_tarea.estado = 'cancelada' THEN RETURN; END IF;

  UPDATE wms_tareas SET estado = 'cancelada',
    notas = CASE WHEN p_motivo IS NOT NULL AND p_motivo <> ''
                 THEN COALESCE(notas || ' — ', '') || 'Cancelada: ' || p_motivo
                 ELSE notas END
  WHERE id = p_tarea_id;

  -- Si se cancela un reabastecimiento con un picking encadenado todavía pendiente, ese
  -- picking quedó apuntando a una ubicación destino que ya no va a recibir stock —
  -- cancelarlo también (no dejar tareas imposibles, mismo criterio que la generación).
  IF v_tarea.tipo = 'replenishment' THEN
    UPDATE wms_tareas SET estado = 'cancelada',
      notas = COALESCE(notas || ' — ', '') || 'Cancelada: se canceló el reabastecimiento del que dependía'
    WHERE tarea_precedente_id = p_tarea_id AND estado IN ('pendiente','en_curso');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_cancelar_tarea_wms(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_cancelar_tarea_wms(uuid, text) TO authenticated, service_role;
