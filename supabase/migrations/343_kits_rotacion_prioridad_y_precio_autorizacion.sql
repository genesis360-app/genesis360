-- 343 — Motor de Rotación, Opción 3 (kits): fix E3 + habilita el tipo de autorización de precio (E2).
-- Relevamiento `relevamiento_rotacion_descuento_respuestas.md`, sección E. GO decidió construir YA
-- lo independiente de tareas/reasignación (Pestaña de supervisor, sin arrancar): E3 (fix técnico de
-- `iniciar_armado_kit`) + E2/E4 (autogenerar nombre/precio del kit, edición manual, autorización de
-- supervisor para el precio — la UI y el flujo de aprobación van en el código de la app; esta
-- migración solo habilita el tipo nuevo en el CHECK existente de `autorizaciones_inventario`).

-- E3 — `iniciar_armado_kit` reservaba componentes ORDER BY created_at a secas, ciego al estado_id
-- (ignoraba si había stock en un estado con descuento por vencimiento). Fix: si el componente tiene
-- la regla "armar kits" efectiva activa (fn_rotacion_reglas_efectivas, jerarquía SKU>categoría>
-- tenant), las líneas en un estado que dispara Rotación se reservan PRIMERO — prioridad, no
-- exclusividad (mismo criterio que la Opción 2/D3: el lote en descuento pierde prioridad para el
-- resto, nunca queda excluido). Para componentes/tenants sin la regla activa, 0 cambio de
-- comportamiento: el CASE siempre da 1 y el ORDER BY queda igual a como estaba.
CREATE OR REPLACE FUNCTION public.iniciar_armado_kit(p_kit_producto_id uuid, p_cantidad numeric, p_ubicacion_id uuid, p_sucursal_id uuid, p_notas text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; rec RECORD; ln RECORD;
  v_requerido numeric; v_disponible numeric; v_restante numeric; v_reservar numeric;
  v_reservados jsonb := '[]'::jsonb; v_log_id uuid; v_nrecetas int;
  v_estados_rotacion uuid[];
  v_armar_kits boolean;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  SELECT count(*) INTO v_nrecetas FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id;
  IF v_nrecetas = 0 THEN RAISE EXCEPTION 'El KIT no tiene receta configurada'; END IF;

  -- Estados que disparan Rotación en este tenant — se resuelve una sola vez (mismo patrón que
  -- estadosPrioridadRotacion en VentasPage.tsx, Opción 2).
  SELECT array_agg(id) INTO v_estados_rotacion FROM estados_inventario WHERE tenant_id = v_tenant AND dispara_rotacion = true;

  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_requerido := rec.cantidad * p_cantidad;
    SELECT COALESCE(sum(cantidad - COALESCE(cantidad_reservada, 0)), 0) INTO v_disponible FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
    IF v_disponible < v_requerido THEN RAISE EXCEPTION 'Stock insuficiente del componente % (necesita %, hay %)', rec.comp_producto_id, v_requerido, v_disponible; END IF;
  END LOOP;

  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id LOOP
    v_restante := rec.cantidad * p_cantidad;

    v_armar_kits := false;
    IF v_estados_rotacion IS NOT NULL THEN
      SELECT r.armar_kits INTO v_armar_kits FROM fn_rotacion_reglas_efectivas(rec.comp_producto_id) r;
    END IF;

    FOR ln IN SELECT id, estado_id, (cantidad - COALESCE(cantidad_reservada, 0)) AS disp FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id)
        AND (cantidad - COALESCE(cantidad_reservada, 0)) > 0
      ORDER BY
        CASE WHEN v_armar_kits AND estado_id = ANY(v_estados_rotacion) THEN 0 ELSE 1 END,
        created_at
    LOOP
      EXIT WHEN v_restante <= 0;
      v_reservar := LEAST(ln.disp, v_restante);
      UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada, 0) + v_reservar WHERE id = ln.id;
      v_reservados := v_reservados || jsonb_build_object('linea_id', ln.id, 'comp_producto_id', rec.comp_producto_id, 'cantidad', v_reservar);
      v_restante := v_restante - v_reservar;
    END LOOP;
  END LOOP;
  INSERT INTO kitting_log (tenant_id, kit_producto_id, cantidad_kits, ubicacion_id, usuario_id, notas, tipo, estado, componentes_reservados)
  VALUES (v_tenant, p_kit_producto_id, p_cantidad, p_ubicacion_id, auth.uid(), p_notas, 'armado', 'en_armado', v_reservados) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END $function$;

-- E2 — nuevo tipo de autorización: cambiar el precio de un KIT (sugerido automáticamente desde la
-- receta) requiere aprobación de DUEÑO/SUPERVISOR/SUPER_USUARIO/ADMIN, mismo patrón que
-- `bulk_edit`/`ajuste_cantidad` en `autorizaciones_inventario` — sin `linea_id` (no es una línea de
-- inventario, es `productos.precio_venta`); el detalle va en `datos_cambio` (producto_id, kit_nombre,
-- precio_anterior, precio_nuevo). El flujo de aprobación vive en InventarioPage.tsx (aprobarAutorizacion),
-- no hace falta un RPC SECURITY DEFINER nuevo: no hay guard/trigger bloqueando un UPDATE directo a
-- productos.precio_venta desde un rol con permisos de escritura (a diferencia de cambio_estado, que
-- sí tiene un guard anti-fraude — ver aprobar_cambio_estado_inventario).
ALTER TABLE public.autorizaciones_inventario DROP CONSTRAINT IF EXISTS autorizaciones_inventario_tipo_check;
ALTER TABLE public.autorizaciones_inventario ADD CONSTRAINT autorizaciones_inventario_tipo_check
  CHECK (tipo = ANY (ARRAY['ajuste_cantidad'::text, 'eliminar_serie'::text, 'eliminar_lpn'::text, 'bulk_edit'::text, 'ajuste_conteo'::text, 'cambio_estado'::text, 'kit_precio'::text]));
