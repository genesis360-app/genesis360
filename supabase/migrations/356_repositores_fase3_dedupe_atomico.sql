-- ============================================================
-- 356_repositores_fase3_dedupe_atomico.sql
-- Fix sobre mig 355, encontrado por el migration-reviewer al revisar esa migración: el dedupe de
-- `fn_generar_tareas_reposicion_gondola` (`CONTINUE WHEN EXISTS (...)`) no es atómico — mismo patrón
-- que ya tenía `fn_generar_tareas_reabastecimiento_umbral` (mig 334), pero acá el pool de quién puede
-- disparar "Revisar reposición" es más amplio (Fase 2 incluye CAJERO/DEPOSITO, no solo supervisores),
-- así que el riesgo real de 2 llamadas concurrentes (doble click, 2 repositores a la vez) es mayor.
-- Sin esto, 2 llamadas simultáneas podían crear 2 tareas activas para el mismo producto+góndola, cada
-- una moviendo stock real del depósito — no corrompe stock (fn_completar_tarea_reabastecimiento sigue
-- validando disponibilidad con FOR UPDATE SKIP LOCKED) pero sí sobre-mueve mercadería y duplica
-- trabajo. Mismo mecanismo que ya resolvió esto para tareas_repositor en mig 352
-- (uq_tareas_repositor_activa + ON CONFLICT DO UPDATE) — acá es DO NOTHING porque no hay nada que
-- actualizar en el conflicto (a diferencia del cartel, reponer 2 veces seguidas no cambia la cantidad
-- a mover de la tarea ya en cola).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_tareas_reposicion_gondola_activa
  ON wms_tareas (producto_id, ubicacion_destino_id)
  WHERE tipo = 'reposicion_gondola' AND estado IN ('pendiente', 'en_curso');

COMMENT ON INDEX uq_wms_tareas_reposicion_gondola_activa IS
  'Mig 356: 1 sola tarea de reposición activa por producto+góndola — arbiter del ON CONFLICT DO NOTHING en fn_generar_tareas_reposicion_gondola. Mismo patrón que uq_tareas_repositor_activa (mig 352).';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_reposicion_gondola(p_tenant_id uuid)
RETURNS TABLE (tarea_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_avanzado   boolean;
  v_pus        RECORD;
  v_stock      integer;
  v_origen_id  uuid;
  v_disponible integer;
  v_nueva_id   uuid;
BEGIN
  SELECT (modo_operacion = 'avanzado') INTO v_avanzado FROM tenants WHERE id = p_tenant_id;
  IF NOT COALESCE(v_avanzado, false) THEN RETURN; END IF;

  FOR v_pus IN
    SELECT pus.producto_id, pus.sucursal_id, pus.ubicacion_exhibicion_id
    FROM producto_ubicacion_sucursal pus
    JOIN ubicaciones ue ON ue.id = pus.ubicacion_exhibicion_id
    WHERE pus.tenant_id = p_tenant_id
      AND ue.tipo_logico = 'exhibicion'
      AND ue.activo = true
      AND ue.disponible_surtido = true
  LOOP
    SELECT COALESCE(SUM(il.cantidad), 0) INTO v_stock
    FROM inventario_lineas il
    WHERE il.producto_id = v_pus.producto_id AND il.ubicacion_id = v_pus.ubicacion_exhibicion_id AND il.activo = true;

    CONTINUE WHEN v_stock > 0;

    -- Chequeo no-atómico (barato, evita el trabajo de buscar origen/cantidad para el caso común
    -- sin carrera) + ON CONFLICT DO NOTHING más abajo como backstop atómico real (mig 356).
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM wms_tareas wt
      WHERE wt.tenant_id = p_tenant_id AND wt.tipo = 'reposicion_gondola'
        AND wt.producto_id = v_pus.producto_id AND wt.ubicacion_destino_id = v_pus.ubicacion_exhibicion_id
        AND wt.estado IN ('pendiente','en_curso')
    );

    SELECT il.ubicacion_id INTO v_origen_id
    FROM inventario_lineas il
    JOIN ubicaciones u2 ON u2.id = il.ubicacion_id
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_pus.producto_id AND il.activo = true
      AND u2.subtipo_almacenamiento IN ('bulk','estiba','camara')
      AND il.ubicacion_id <> v_pus.ubicacion_exhibicion_id
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
    ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
    LIMIT 1;

    CONTINUE WHEN v_origen_id IS NULL;

    SELECT COALESCE(SUM(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_pus.producto_id
      AND il.ubicacion_id = v_origen_id AND il.activo = true;

    CONTINUE WHEN v_disponible <= 0;

    v_nueva_id := NULL;
    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, origen, usuario_asignado_id, notas)
    VALUES (p_tenant_id, v_pus.sucursal_id, 'reposicion_gondola', v_pus.producto_id, v_disponible, v_origen_id, v_pus.ubicacion_exhibicion_id, 'repositor',
            fn_repositor_elegir_asignado(p_tenant_id, v_pus.sucursal_id),
            'Góndola sin stock — ' || fn_wms_describir_cantidad(v_pus.producto_id, v_disponible))
    ON CONFLICT (producto_id, ubicacion_destino_id) WHERE tipo = 'reposicion_gondola' AND estado IN ('pendiente', 'en_curso')
    DO NOTHING
    RETURNING id INTO v_nueva_id;

    IF v_nueva_id IS NOT NULL THEN
      RETURN QUERY SELECT v_nueva_id;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_reposicion_gondola(uuid) IS
  'Repositores Fase 3 (mig 355, dedupe atómico mig 356): genera tareas wms_tareas.tipo=reposicion_gondola para SKUs cuya ubicación de exhibición quedó en 0 — mueve el lote FEFO completo disponible en depósito (bulk/estiba/camara). Solo considera góndolas con disponible_surtido=true. ON CONFLICT DO NOTHING sobre uq_wms_tareas_reposicion_gondola_activa cierra la condición de carrera de 2 llamadas concurrentes. Llamada bajo demanda desde el botón "Revisar reposición" de /repositores.';
