-- 345_armado_kits_automatico_d2.sql
-- D2 — Combos automáticos TN/MELI (relevamiento_ml_tn_combos_repricing_respuestas.md, Bloque 1).
-- Cuando una orden de TiendaNube o MercadoLibre vende un KIT y no hay stock ya armado suficiente,
-- pero SÍ alcanza el stock de los componentes en ubicaciones habilitadas para ese canal, el sistema
-- genera automáticamente una TAREA de armado (A2: todo-o-nada, nunca arma en silencio) asignada al
-- operario por defecto del tenant si hay uno configurado (Config → Inventario → Zonas), con alerta a
-- DUEÑO/SUPERVISOR/SUPER_USUARIO (A4). El kit ya es su propio SKU desde la mig 040/244 — esto NO
-- inventa un sistema de kitting nuevo, reusa `kit_recetas`/`kitting_log`/`confirmar_armado_kit` tal
-- cual, solo agrega el camino de disparo automático (sin `auth.uid()`, invocable desde un webhook con
-- `service_role`) y la cola de trabajo (`wms_tareas`) para que el depósito lo vea y complete.

-- ── 1) wms_tareas: nuevo tipo 'armado', nuevo origen 'marketplace', link al kitting_log real ───────
ALTER TABLE wms_tareas DROP CONSTRAINT IF EXISTS wms_tareas_tipo_check;
ALTER TABLE wms_tareas ADD CONSTRAINT wms_tareas_tipo_check
  CHECK (tipo IN ('picking','replenishment','putaway','conteo','armado'));

ALTER TABLE wms_tareas DROP CONSTRAINT IF EXISTS wms_tareas_origen_check;
ALTER TABLE wms_tareas ADD CONSTRAINT wms_tareas_origen_check
  CHECK (origen IN ('envio','manual','umbral','pedido','marketplace'));

ALTER TABLE wms_tareas ADD COLUMN IF NOT EXISTS kitting_log_id uuid REFERENCES kitting_log(id) ON DELETE SET NULL;
COMMENT ON COLUMN wms_tareas.kitting_log_id IS
  'Solo para tipo=armado: el kitting_log (mig 040) que esta tarea representa. confirmar_armado_kit ya existente hace el consumo/ingreso real de stock — esta tarea es la cola de trabajo del depósito, no un segundo lugar donde vive el stock.';

CREATE INDEX IF NOT EXISTS idx_wms_tareas_kitting_log ON wms_tareas (kitting_log_id) WHERE kitting_log_id IS NOT NULL;

-- ── 2) productos: ubicación de armado por defecto (A3 del relevamiento) ────────────────────────────
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ubicacion_kit_default_id uuid REFERENCES ubicaciones(id) ON DELETE SET NULL;
COMMENT ON COLUMN productos.ubicacion_kit_default_id IS
  'Solo para es_kit=true: dónde deja el stock el armado AUTOMÁTICO (D2) al no haber un operario eligiendo la ubicación en el momento, a diferencia del armado manual (iniciar_armado_kit, que sigue pidiéndola siempre). NULL = el kit arma sin ubicación asignada.';

-- ── 3) tenants: operario por defecto para tareas de armado automático ──────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wms_armado_operario_default_id uuid REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN tenants.wms_armado_operario_default_id IS
  'Preset de Config → Inventario → Zonas: a quién nace pre-asignada una tarea de armado automático (D2). NULL = nace sin asignar, la puede tomar cualquiera del depósito (mismo criterio que picking/reabastecimiento hoy).';

-- ── 4) fn_iniciar_armado_kit_auto — variante SIN auth.uid(), invocable desde un webhook con ────────
--    service_role. Mismo algoritmo de reserva que iniciar_armado_kit (mig 343, con prioridad de
--    Rotación), con el filtro adicional de canal: solo cuenta componentes en ubicaciones/estados
--    habilitados para ese canal (mismo criterio que ya usan tn-stock-worker/meli-stock-worker para el
--    push saliente de stock — acá se aplica por primera vez también en la RESERVA de una orden
--    entrante). Todo-o-nada (A2): si no alcanza, no reserva nada y devuelve NULL — el llamador
--    (el webhook) sigue el mismo camino que ya tiene hoy para "sin stock" en cualquier producto.
CREATE OR REPLACE FUNCTION public.fn_iniciar_armado_kit_auto(
  p_tenant_id       uuid,
  p_kit_producto_id uuid,
  p_cantidad        numeric,
  p_canal           text,             -- 'TiendaNube' | 'MercadoLibre'
  p_sucursal_id     uuid DEFAULT NULL,
  p_origen_ref      text DEFAULT NULL, -- referencia libre para trazabilidad (nº de orden del canal)
  p_notas           text DEFAULT NULL
) RETURNS uuid  -- wms_tareas.id del armado generado, o NULL si no alcanzó el stock de componentes
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD; ln RECORD;
  v_requerido numeric; v_disponible numeric; v_restante numeric; v_reservar numeric;
  v_reservados jsonb := '[]'::jsonb; v_log_id uuid; v_nrecetas int;
  v_estados_rotacion uuid[]; v_armar_kits boolean;
  v_ubicacion_destino uuid; v_operario_default uuid; v_tarea_id uuid;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_canal NOT IN ('TiendaNube','MercadoLibre') THEN RAISE EXCEPTION 'Canal inválido: %', p_canal; END IF;

  -- A diferencia del armado manual (un click humano por vez, carrera improbable), este camino lo
  -- dispara un webhook: dos órdenes casi simultáneas del mismo kit (mismo combo en TN y MELI, o un
  -- reintento) sí pueden pisarse. Serializa las llamadas concurrentes de ESTE kit en ESTE tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_kit_producto_id::text, 0));

  SELECT count(*) INTO v_nrecetas FROM kit_recetas WHERE tenant_id = p_tenant_id AND kit_producto_id = p_kit_producto_id;
  IF v_nrecetas = 0 THEN RETURN NULL; END IF;

  SELECT array_agg(id) INTO v_estados_rotacion FROM estados_inventario WHERE tenant_id = p_tenant_id AND dispara_rotacion = true;

  -- 4a. Validar disponible por componente, SOLO en ubicaciones con una ubicación real (requiere
  --     ubicacion_id — a diferencia del armado manual, acá no hay un operario que decida a mano
  --     tomar de un LPN "sin ubicación") habilitada para el canal, y estado habilitado para el canal.
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = p_tenant_id AND kit_producto_id = p_kit_producto_id LOOP
    v_requerido := rec.cantidad * p_cantidad;
    SELECT COALESCE(sum(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    JOIN ubicaciones u ON u.id = il.ubicacion_id
    LEFT JOIN estados_inventario ei ON ei.id = il.estado_id
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = rec.comp_producto_id AND il.activo = true
      AND (p_sucursal_id IS NULL OR il.sucursal_id = p_sucursal_id)
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
      AND (CASE WHEN p_canal = 'TiendaNube' THEN u.disponible_tn ELSE u.disponible_meli END) IS TRUE
      AND (il.estado_id IS NULL OR (CASE WHEN p_canal = 'TiendaNube' THEN ei.es_disponible_tn ELSE ei.es_disponible_meli END) IS NOT FALSE);
    IF v_disponible < v_requerido THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- 4b. Reservar FIFO, misma prioridad de Rotación que iniciar_armado_kit (mig 343), mismo filtro de canal.
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = p_tenant_id AND kit_producto_id = p_kit_producto_id LOOP
    v_restante := rec.cantidad * p_cantidad;

    v_armar_kits := false;
    IF v_estados_rotacion IS NOT NULL THEN
      SELECT r.armar_kits INTO v_armar_kits FROM fn_rotacion_reglas_efectivas(rec.comp_producto_id) r;
    END IF;

    FOR ln IN
      SELECT il.id, il.estado_id, (il.cantidad - COALESCE(il.cantidad_reservada,0)) AS disp
      FROM inventario_lineas il
      JOIN ubicaciones u ON u.id = il.ubicacion_id
      LEFT JOIN estados_inventario ei ON ei.id = il.estado_id
      WHERE il.tenant_id = p_tenant_id AND il.producto_id = rec.comp_producto_id AND il.activo = true
        AND (p_sucursal_id IS NULL OR il.sucursal_id = p_sucursal_id)
        AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
        AND (CASE WHEN p_canal = 'TiendaNube' THEN u.disponible_tn ELSE u.disponible_meli END) IS TRUE
        AND (il.estado_id IS NULL OR (CASE WHEN p_canal = 'TiendaNube' THEN ei.es_disponible_tn ELSE ei.es_disponible_meli END) IS NOT FALSE)
      ORDER BY
        CASE WHEN v_armar_kits AND il.estado_id = ANY(v_estados_rotacion) THEN 0 ELSE 1 END,
        il.created_at
    LOOP
      EXIT WHEN v_restante <= 0;
      v_reservar := LEAST(ln.disp, v_restante);
      UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada,0) + v_reservar WHERE id = ln.id;
      v_reservados := v_reservados || jsonb_build_object('linea_id', ln.id, 'comp_producto_id', rec.comp_producto_id, 'cantidad', v_reservar);
      v_restante := v_restante - v_reservar;
    END LOOP;

    -- El advisory lock ya serializa contra OTRA llamada a esta misma función para este kit, pero
    -- no contra una venta/ajuste que consuma el mismo componente por otro camino en el mismo
    -- instante — si eso pasó entre el check 4a y esta reserva, no seguir con una reserva parcial:
    -- abortar toda la transacción (sin bloque EXCEPTION acá arriba → rollback automático de todos
    -- los UPDATE cantidad_reservada ya hechos en esta llamada). Todo-o-nada real, no solo de nombre.
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Race: stock de % cambió entre el chequeo y la reserva (faltan %)', rec.comp_producto_id, v_restante;
    END IF;
  END LOOP;

  SELECT ubicacion_kit_default_id INTO v_ubicacion_destino FROM productos WHERE id = p_kit_producto_id;
  SELECT wms_armado_operario_default_id INTO v_operario_default FROM tenants WHERE id = p_tenant_id;

  INSERT INTO kitting_log (tenant_id, kit_producto_id, cantidad_kits, ubicacion_id, usuario_id, notas, tipo, estado, componentes_reservados)
  VALUES (p_tenant_id, p_kit_producto_id, p_cantidad, v_ubicacion_destino, NULL,
          COALESCE(p_notas, 'Armado automático — orden ' || p_canal || COALESCE(' #' || p_origen_ref, '')),
          'armado', 'en_armado', v_reservados)
  RETURNING id INTO v_log_id;

  -- wms_tareas.cantidad es integer (unidades base, igual criterio que picking/reabastecimiento) —
  -- kitting_log.cantidad_kits (numeric) es la fuente de verdad real que usa confirmar_armado_kit;
  -- acá el cast es explícito a propósito, no un redondeo implícito silencioso.
  INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_destino_id,
                          origen, usuario_asignado_id, kitting_log_id, notas)
  VALUES (p_tenant_id, p_sucursal_id, 'armado', p_kit_producto_id, p_cantidad::integer, v_ubicacion_destino,
          'marketplace', v_operario_default, v_log_id,
          'Armar ' || p_cantidad || ' — orden ' || p_canal || COALESCE(' #' || p_origen_ref, ''))
  RETURNING id INTO v_tarea_id;

  -- A4: nunca silencioso — alerta a DUEÑO/SUPERVISOR/SUPER_USUARIO del tenant.
  INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
  SELECT p_tenant_id, u.id, 'armado_automatico',
         'Se generó una tarea de armado automático',
         'Orden de ' || p_canal || COALESCE(' #' || p_origen_ref, '') || ' — hay que armar ' || p_cantidad || ' kit(s).',
         '/pedidos?tab=wms'
  FROM users u WHERE u.tenant_id = p_tenant_id AND u.rol IN ('DUEÑO','SUPERVISOR','SUPER_USUARIO') AND u.activo = true;

  RETURN v_tarea_id;
END $function$;

COMMENT ON FUNCTION public.fn_iniciar_armado_kit_auto(uuid, uuid, numeric, text, uuid, text, text) IS
  'D2 — disparo automático de armado de kit desde una orden de marketplace. Sin auth.uid(): recibe p_tenant_id explícito, pensada para invocarse con el cliente service_role desde tn-webhook/meli-webhook (que es exactamente lo que bypassea RLS, no un SECURITY DEFINER). NO otorgar a authenticated: un tenant_id arbitrario en manos de un usuario común sería cross-tenant si alguna de las tablas que toca no tuviera RLS bien puesta.';

REVOKE ALL ON FUNCTION public.fn_iniciar_armado_kit_auto(uuid, uuid, numeric, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_iniciar_armado_kit_auto(uuid, uuid, numeric, text, uuid, text, text) TO service_role;

-- ── 5) fn_completar_tarea_armado — la completa un operario logueado real desde Pedidos/Picking. ───
--    Reusa confirmar_armado_kit tal cual (mismo ledger, mismo consumo/ingreso de stock) — Regla de
--    Oro #0: nunca duplicar el camino de escritura de stock de kitting.
CREATE OR REPLACE FUNCTION public.fn_completar_tarea_armado(p_tarea_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_tarea  RECORD;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;

  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id;
  IF v_tarea.id IS NULL THEN RAISE EXCEPTION 'Tarea no encontrada'; END IF;
  IF v_tarea.tenant_id <> v_tenant THEN RAISE EXCEPTION 'Tarea de otro tenant'; END IF;
  IF v_tarea.tipo <> 'armado' THEN RAISE EXCEPTION 'Esta tarea no es de armado (tipo=%)', v_tarea.tipo; END IF;
  IF v_tarea.estado NOT IN ('pendiente','en_curso') THEN RAISE EXCEPTION 'La tarea no está pendiente (estado=%)', v_tarea.estado; END IF;
  IF v_tarea.kitting_log_id IS NULL THEN RAISE EXCEPTION 'La tarea no tiene un armado asociado'; END IF;

  PERFORM confirmar_armado_kit(v_tarea.kitting_log_id, v_tarea.sucursal_id);

  UPDATE wms_tareas SET estado = 'completada', completed_at = now() WHERE id = p_tarea_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_completar_tarea_armado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_completar_tarea_armado(uuid) TO authenticated, service_role;

-- ── 6) fn_cancelar_tarea_wms — se EXTIENDE (mismo nombre/firma, ningún GRANT nuevo hace falta) para
--    liberar la reserva de componentes cuando se cancela una tarea de armado. Sin esto, cancelar una
--    tarea tipo='armado' desde el botón genérico de Pedidos→Tareas WMS dejaría cantidad_reservada
--    de los componentes bloqueada para siempre (kitting_log queda 'en_armado' sin nadie que lo mire) —
--    Regla de Oro #0, stock fantasma.
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

  IF v_tarea.tipo = 'armado' AND v_tarea.kitting_log_id IS NOT NULL THEN
    PERFORM cancelar_armado_kit(v_tarea.kitting_log_id);
  END IF;

  UPDATE wms_tareas SET estado = 'cancelada',
    notas = CASE WHEN p_motivo IS NOT NULL AND p_motivo <> ''
                 THEN COALESCE(notas || ' — ', '') || 'Cancelada: ' || p_motivo
                 ELSE notas END
  WHERE id = p_tarea_id;

  -- (mig 291, preservada) Si se cancela un reabastecimiento con un picking encadenado todavía
  -- pendiente, ese picking quedó apuntando a una ubicación destino que ya no va a recibir stock —
  -- cancelarlo también (no dejar tareas imposibles, mismo criterio que la generación).
  IF v_tarea.tipo = 'replenishment' THEN
    UPDATE wms_tareas SET estado = 'cancelada',
      notas = COALESCE(notas || ' — ', '') || 'Cancelada: se canceló el reabastecimiento del que dependía'
    WHERE tarea_precedente_id = p_tarea_id AND estado IN ('pendiente','en_curso');
  END IF;
END;
$$;
