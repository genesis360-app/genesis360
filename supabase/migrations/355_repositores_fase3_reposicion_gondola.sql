-- ============================================================
-- 355_repositores_fase3_reposicion_gondola.sql
-- Repositores — Fase 3: reposición física de stock a góndola (B1/B3/D1/D2/D3 del relevamiento,
-- I3 resuelto por investigación de código — ver comentario de mig 352). GO eligió esta fase de las
-- 2 que quedaban (reposición física / etiquetas+impresión).
--
-- 🛑 I3 investigado DE NUEVO en esta sesión, con un hallazgo que corrige el resuelto anterior: NO
-- hace falta un "tercer tramo separado" para el movimiento de stock — `fn_wms_elegir_ubicacion_picking`
-- filtra duro por tipo_logico='picking' (eso SÍ bloquea el camino automático de picking), pero el
-- camino de reabastecimiento POR UMBRAL (`fn_generar_tareas_reabastecimiento_umbral`, mig 290/291/334)
-- NO tiene ningún filtro de tipo_logico en SQL — el destino sale directo de
-- `producto_ubicacion_umbrales.ubicacion_id`, sin restricción. El único blocker real era la UI de
-- Config (que solo ofrece ubicaciones picking en el selector de umbrales). Conclusión final de I3,
-- más precisa que la de mig 352: SÍ se reusa el MECANISMO real de movimiento de stock
-- (`fn_completar_tarea_reabastecimiento`, que tampoco valida tipo de destino), con un `tipo` NUEVO en
-- `wms_tareas` (mismo precedente que 'armado', mig 345) para que la tarea viva conceptualmente en
-- Repositores y NUNCA se mezcle con la cola de Picking/WMS del depósito.
--
-- 🛑 Verificado ANTES de diseñar (REGLA #0): el stock que llega a una ubicación `tipo_logico=
-- 'exhibicion'` es INVISIBLE para una venta de mostrador normal si esa ubicación tiene
-- `disponible_surtido=false` (default desde mig 336 para toda ubicación nueva) — confirmado
-- grepeando el sourcing real de venta (`VentasPage.tsx`, ~8 queries filtran
-- `ubicaciones.disponible_surtido !== false`). Sin este chequeo, completar una tarea de reposición
-- física movería stock real a un lugar donde el POS seguiría diciendo "sin stock" — mismatch
-- físico/sistema. El generador de abajo SOLO considera góndolas con `disponible_surtido = true`
-- (toggle ya existente en Config → Ubicaciones, ícono de carrito) — si el dueño no lo habilitó
-- todavía para una góndola, esa góndola simplemente no genera tareas (no es un error).
--
-- Regla de disparo (MVP, cero configuración extra — mismo criterio que Fase 1): se genera una tarea
-- cuando el stock en la ubicación de exhibición de un SKU llega a CERO. No requiere que el dueño
-- configure un umbral mín/máx por SKU+góndola (eso ya existe para picking vía
-- `producto_ubicacion_umbrales`, pero es trabajo de configuración extra que el relevamiento no pidió
-- para esta fase) — la cantidad a mover es la del lote FEFO completo que se encuentra en depósito
-- (bulk/estiba/camara), igual que agarraría una caja un repositor real.
-- ============================================================

-- ── 1) wms_tareas: nuevo tipo 'reposicion_gondola', nuevo origen 'repositor' ────────────────────────
ALTER TABLE wms_tareas DROP CONSTRAINT IF EXISTS wms_tareas_tipo_check;
ALTER TABLE wms_tareas ADD CONSTRAINT wms_tareas_tipo_check
  CHECK (tipo IN ('picking','replenishment','putaway','conteo','armado','reposicion_gondola'));

ALTER TABLE wms_tareas DROP CONSTRAINT IF EXISTS wms_tareas_origen_check;
ALTER TABLE wms_tareas ADD CONSTRAINT wms_tareas_origen_check
  CHECK (origen IN ('envio','manual','umbral','pedido','marketplace','repositor'));

COMMENT ON COLUMN wms_tareas.tipo IS
  'picking/replenishment/putaway/conteo (mig 289) + armado (mig 345) + reposicion_gondola (mig 355): mover stock real de depósito a una ubicación de exhibición — usa el mismo mecanismo que replenishment (fn_completar_tarea_reabastecimiento), vive en el módulo Repositores, nunca en Picking.';

-- ── 2) Guard: usuario_asignado_id tiene que pertenecer al mismo tenant ──────────────────────────────
-- wms_tareas.usuario_asignado_id existe desde mig 289 y YA se usa en PickingPage (filtro "mías o
-- libres", pedido de GO 2026-08-08) pero nunca tuvo este guard — mismo gap que ya se cerró para
-- tareas_repositor en mig 354 (fn_tarea_repositor_asignado_valido_tenant), mismo fix acá.
CREATE OR REPLACE FUNCTION public.fn_wms_tarea_asignado_valido_tenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.usuario_asignado_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.usuario_asignado_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'El usuario asignado debe pertenecer al mismo negocio.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wms_tarea_asignado_valido_tenant ON public.wms_tareas;
CREATE TRIGGER trg_wms_tarea_asignado_valido_tenant
  BEFORE INSERT OR UPDATE OF usuario_asignado_id ON public.wms_tareas
  FOR EACH ROW EXECUTE FUNCTION public.fn_wms_tarea_asignado_valido_tenant();

REVOKE ALL ON FUNCTION public.fn_wms_tarea_asignado_valido_tenant() FROM PUBLIC, anon, authenticated;

-- ── 2b) fn_repositor_elegir_asignado (mig 354) gana un 2do llamador ─────────────────────────────────
-- Hasta ahora solo la llamaban los triggers SECURITY DEFINER de mig 352/354 (efectivo = owner, el
-- REVOKE a `authenticated` no importaba). El generador de abajo es SECURITY INVOKER (a propósito, ver
-- comentario del punto 3) y lo llama un usuario autenticado por RPC directa — sin este GRANT fallaría
-- con "permission denied for function fn_repositor_elegir_asignado". Sigue sin ser RPC-invocable
-- DIRECTAMENTE desde el frontend (nadie la llama por nombre desde src/), solo cambia quién puede
-- invocarla como parte de la cadena de otra función.
GRANT EXECUTE ON FUNCTION public.fn_repositor_elegir_asignado(uuid, uuid) TO authenticated;

-- ── 3) Generador — mismo shape que fn_generar_tareas_reabastecimiento_umbral (mig 334), pero: ───────
--    origen = stock EN CERO en la ubicación de exhibición (no un umbral configurado), destino =
--    producto_ubicacion_sucursal.ubicacion_exhibicion_id (no producto_ubicacion_umbrales), y
--    usuario_asignado_id se completa con el mismo reparto por carga de Repositores (mig 354).
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
      AND ue.disponible_surtido = true  -- si no, el stock movido quedaría invisible para la venta (REGLA #0)
  LOOP
    SELECT COALESCE(SUM(il.cantidad), 0) INTO v_stock
    FROM inventario_lineas il
    WHERE il.producto_id = v_pus.producto_id AND il.ubicacion_id = v_pus.ubicacion_exhibicion_id AND il.activo = true;

    CONTINUE WHEN v_stock > 0;  -- MVP: reponer recién cuando la góndola quedó en cero

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

    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, origen, usuario_asignado_id, notas)
    VALUES (p_tenant_id, v_pus.sucursal_id, 'reposicion_gondola', v_pus.producto_id, v_disponible, v_origen_id, v_pus.ubicacion_exhibicion_id, 'repositor',
            fn_repositor_elegir_asignado(p_tenant_id, v_pus.sucursal_id),
            'Góndola sin stock — ' || fn_wms_describir_cantidad(v_pus.producto_id, v_disponible))
    RETURNING id INTO v_nueva_id;

    RETURN QUERY SELECT v_nueva_id;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_reposicion_gondola(uuid) IS
  'Repositores Fase 3 (mig 355): genera tareas wms_tareas.tipo=reposicion_gondola para SKUs cuya ubicación de exhibición (producto_ubicacion_sucursal.ubicacion_exhibicion_id) quedó en 0 — mueve el lote FEFO completo disponible en depósito (bulk/estiba/camara). Solo considera góndolas con disponible_surtido=true. Llamada bajo demanda desde el botón "Revisar reposición" de /repositores (mismo patrón que fn_generar_tareas_reabastecimiento_umbral en Picking) — no hay cron en este proyecto (ver reference_pg_cron_no_habilitado).';

REVOKE ALL ON FUNCTION public.fn_generar_tareas_reposicion_gondola(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generar_tareas_reposicion_gondola(uuid) TO authenticated, service_role;

-- ── 4) fn_completar_tarea_reabastecimiento — se REUSA (mismo mecanismo, I3), solo se relaja el guard
--    de tipo. Resto del cuerpo IDÉNTICO a mig 297 (incluida la transferencia proporcional de reserva)
--    — un solo lugar donde vive esta lógica de REGLA #0, no una copia paralela para el tipo nuevo.
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
  IF v_tarea.tipo NOT IN ('replenishment', 'reposicion_gondola') THEN RAISE EXCEPTION 'Esta tarea no es de reabastecimiento'; END IF;
  IF v_tarea.estado = 'completada' THEN RETURN; END IF;
  IF v_tarea.estado = 'cancelada' THEN RAISE EXCEPTION 'La tarea está cancelada'; END IF;
  IF v_tarea.ubicacion_destino_id IS NULL THEN
    RAISE EXCEPTION 'La tarea no tiene ubicación de destino configurada%', CASE WHEN v_tarea.tipo = 'reposicion_gondola'
      THEN ' — no debería pasar para una reposición a góndola, revisá la tarea'
      ELSE ' — asigná una zona de picking en Configuración → Zonas antes de completarla' END;
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

COMMENT ON FUNCTION public.fn_completar_tarea_reabastecimiento(uuid) IS
  'Mueve stock físico de ubicacion_origen_id a ubicacion_destino_id (nuevo LPN, transfiere reserva proporcional — mig 297). Reusada por tipo=replenishment (picking) Y tipo=reposicion_gondola (mig 355, Repositores) — es el mismo mecanismo de movimiento de stock para ambos, no se duplica.';
