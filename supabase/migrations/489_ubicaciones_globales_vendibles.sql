-- 489 — Stock en ubicaciones GLOBALES visible y vendible (reservable) desde todas las sucursales — Fase 1 (UAT §111)
--
-- Decisión de GO (2026-10-08): el stock que está en una ubicación Global (`ubicaciones.sucursal_id IS NULL`) sigue siendo
-- de la sucursal que lo cargó (`inventario_lineas.sucursal_id`), pero se ve y se vende desde todas. Una venta de A que usa
-- stock de B va SIEMPRE por reserva + pedido (B pickea, A entrega). Fuera de las Globales, el inventario por sucursal sigue
-- estricto.
--
--   1. fn_stock_global_otras_sucursales: el POS lee el stock de OTRAS sucursales en ubicaciones Globales (sin tocar la RLS:
--      el resto de las pantallas sigue viendo solo su sucursal).
--   2. fn_venta_reservar_linea: acepta un LPN de otra sucursal SOLO si su ubicación es Global (antes: rechazo siempre).
--      Productos con serie: siguen estrictos (su reserva no pasa por esta función).
--   3. tenants.pos_permite_cambiar_lpn: si el POS puede cambiar el LPN que sugiere la regla de rebaje (default true =
--      comportamiento de siempre; false = estricto, se pickea lo que dice el sistema).

-- ── 1. Lectura para el POS: stock de OTRAS sucursales en ubicaciones Globales ───────────────────────────────────────────
-- Función y no una policy de SELECT: con una policy, un usuario restringido a A pasaría a VER los LPN de B en todas las
-- pantallas sin poder modificarlos (los UPDATE de la app sobre esos LPN afectarían 0 filas en silencio). Así solo el POS los
-- ve, y la reserva pasa por fn_venta_reservar_linea. Solo productos sin serie, solo LPN ubicados en una Global.
CREATE OR REPLACE FUNCTION public.fn_stock_global_otras_sucursales(p_producto_ids uuid[], p_sucursal_id uuid)
RETURNS TABLE (id uuid, producto_id uuid, lpn text, cantidad integer, cantidad_reservada integer, created_at timestamptz,
               fecha_vencimiento date, estado_id uuid, ubicacion_id uuid, sucursal_id uuid, sucursal_nombre text,
               talle text, color text, encaje text, formato text, sabor_aroma text,
               ubicacion_nombre text, ubicacion_prioridad integer, ubicacion_disponible_surtido boolean,
               estado_nombre text, estado_descuento_pct numeric, estado_disponible_venta boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT il.id, il.producto_id, il.lpn, il.cantidad::integer, COALESCE(il.cantidad_reservada, 0)::integer, il.created_at,
         il.fecha_vencimiento, il.estado_id, il.ubicacion_id, il.sucursal_id, s.nombre,
         il.talle, il.color, il.encaje, il.formato, il.sabor_aroma,
         u.nombre, u.prioridad, u.disponible_surtido,
         e.nombre, e.descuento_pct, e.es_disponible_venta
    FROM inventario_lineas il
    JOIN ubicaciones u ON u.id = il.ubicacion_id AND u.sucursal_id IS NULL
    JOIN productos p ON p.id = il.producto_id AND NOT COALESCE(p.tiene_series, false)
    LEFT JOIN sucursales s ON s.id = il.sucursal_id
    LEFT JOIN estados_inventario e ON e.id = il.estado_id
   WHERE il.tenant_id = get_user_tenant_id()
     AND il.producto_id = ANY (p_producto_ids)
     AND il.activo AND il.cantidad > 0
     AND il.sucursal_id IS NOT NULL AND p_sucursal_id IS NOT NULL AND il.sucursal_id <> p_sucursal_id
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = il.tenant_id AND t.modo_operacion = 'avanzado')
$$;
REVOKE ALL ON FUNCTION public.fn_stock_global_otras_sucursales(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_stock_global_otras_sucursales(uuid[], uuid) TO authenticated;

-- ── 2. Reservar: excepción de ubicación Global ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venta_reservar_linea(p_venta_item_id uuid, p_linea_id uuid, p_cantidad numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item     RECORD;
  v_linea    RECORD;
  v_reservar numeric;
  v_global   boolean;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN 0; END IF;

  -- Lock de la venta: una liberación concurrente no puede dejar una reserva anotada sobre una venta ya cancelada.
  SELECT vi.id, vi.tenant_id, vi.venta_id, vi.producto_id, v.sucursal_id, v.estado
    INTO v_item
    FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
   WHERE vi.id = p_venta_item_id
   FOR UPDATE OF v;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Ítem de venta inexistente'; END IF;
  PERFORM fn_venta_reserva_check_acceso(v_item.tenant_id, v_item.sucursal_id);
  IF v_item.estado IN ('despachada', 'facturada', 'cancelada', 'devuelta') THEN
    RAISE EXCEPTION 'La venta está % — no se puede reservar stock', v_item.estado;
  END IF;

  SELECT id, tenant_id, producto_id, sucursal_id, ubicacion_id, activo, cantidad, COALESCE(cantidad_reservada, 0) AS reservada
    INTO v_linea
    FROM inventario_lineas WHERE id = p_linea_id FOR UPDATE;
  IF v_linea.id IS NULL OR NOT v_linea.activo THEN RETURN 0; END IF;   -- igual que fn_reservar_stock_linea: no rompe al caller
  IF v_linea.tenant_id <> v_item.tenant_id OR v_linea.producto_id <> v_item.producto_id THEN
    RAISE EXCEPTION 'El LPN no corresponde al producto de la venta';
  END IF;
  -- Inventario por sucursal estricto, con UNA excepción (mig 489, GO 2026-10-08): el LPN de otra sucursal se puede reservar
  -- si está en una ubicación GLOBAL. Sigue siendo de su sucursal; la tarea de picking cae en ella.
  IF v_linea.sucursal_id IS NOT NULL AND v_item.sucursal_id IS NOT NULL AND v_linea.sucursal_id <> v_item.sucursal_id THEN
    SELECT EXISTS (SELECT 1 FROM ubicaciones u WHERE u.id = v_linea.ubicacion_id AND u.sucursal_id IS NULL) INTO v_global;
    IF NOT COALESCE(v_global, false) THEN
      RAISE EXCEPTION 'Ese stock es de otra sucursal y no está en una ubicación Global: no se puede reservar para esta venta'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_reservar := FLOOR(LEAST(p_cantidad, GREATEST(v_linea.cantidad - v_linea.reservada, 0)));
  IF v_reservar <= 0 THEN RETURN 0; END IF;

  UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada, 0) + v_reservar WHERE id = p_linea_id;

  INSERT INTO venta_item_reservas (tenant_id, venta_id, venta_item_id, linea_id, producto_id, cantidad)
  VALUES (v_item.tenant_id, v_item.venta_id, v_item.id, p_linea_id, v_item.producto_id, v_reservar::integer)
  ON CONFLICT (venta_item_id, linea_id) DO UPDATE SET cantidad = venta_item_reservas.cantidad + EXCLUDED.cantidad;

  UPDATE venta_items SET reserva_anotada = true WHERE id = v_item.id AND NOT reserva_anotada;

  RETURN v_reservar;
END;
$$;

-- ── 3. Config: el POS puede cambiar el LPN sugerido ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS pos_permite_cambiar_lpn boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.tenants.pos_permite_cambiar_lpn IS
  'Mig 489: true = en el POS se puede elegir otro LPN que el sugerido por la regla de rebaje; false = estricto.';
