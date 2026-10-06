-- 470 — Ajustes de la revisión de la 469 (B2 / Fase 5). Solo reporte y saneamiento: no cambia ningún precio ni el tope.
--
--  1. Reporte F3: las devoluciones PARCIALES (la venta sigue 'despachada'/'facturada') se descuentan en proporción a lo
--     devuelto de cada producto en cada venta. Antes contaba el 100 %. Y solo usuarios activos.
--  2. `descuento_categoria_monto`: el tope pasa a ser lo que la línea quedó por debajo de la lista ((lista − precio) ×
--     cantidad), no la línea entera. Un valor inflado desde el navegador ya no puede superar el descuento real.
--  3. Presupuesto re-cotizado ("Actualizar precios") sin monto nuevo: no conserva el de antes, que era de otro precio.

-- ── F2/F3 server-side ───────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_venta_items_precio_lista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r       jsonb;
  v_cliente uuid;
  v_estado  text;
  v_modo    text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT estado INTO v_estado FROM ventas WHERE id = NEW.venta_id;
    -- Mig 470: un presupuesto re-cotizado sin monto nuevo no conserva el de antes (era de otro precio).
    IF v_estado = 'pendiente' AND NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario
       AND NEW.descuento_categoria_monto IS NOT DISTINCT FROM OLD.descuento_categoria_monto THEN
      NEW.descuento_categoria_monto := NULL;
    END IF;
    IF v_estado IS DISTINCT FROM 'pendiente'
       OR (NEW.precio_unitario IS NOT DISTINCT FROM OLD.precio_unitario AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id) THEN
      NEW.precio_lista_unitario   := OLD.precio_lista_unitario;
      NEW.categoria_cliente_id    := OLD.categoria_cliente_id;
      NEW.categoria_descuento_pct := OLD.categoria_descuento_pct;
      NEW.descuento_categoria_monto := OLD.descuento_categoria_monto;
      RETURN NEW;
    END IF;
  END IF;

  NEW.precio_lista_unitario := NULL;
  NEW.categoria_cliente_id := NULL;
  NEW.categoria_descuento_pct := NULL;
  IF NEW.producto_id IS NULL OR auth.uid() IS NULL THEN NEW.descuento_categoria_monto := NULL; RETURN NEW; END IF;

  SELECT cliente_id INTO v_cliente FROM ventas WHERE id = NEW.venta_id;
  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = NEW.tenant_id;
  BEGIN
    v_r := fn_precio_motor_cliente(NEW.tenant_id, NEW.producto_id, 0, NULL, v_cliente);
  EXCEPTION WHEN OTHERS THEN
    v_r := NULL;   -- p. ej. producto en USD sin cotización: el POS no lo deja vender; acá no se inventa una lista
  END;
  IF v_r IS NOT NULL THEN
    NEW.precio_lista_unitario := fn_precio_redondear((v_r->>'precio_lista')::numeric, v_modo);
    NEW.categoria_cliente_id := (v_r->>'categoria_id')::uuid;
    NEW.categoria_descuento_pct := (v_r->>'categoria_pct')::numeric;
  END IF;
  -- Mig 469 (F3): lo que la categoría bajó en esta línea. Solo si ganó la categoría y el cliente la tiene; nunca
  -- negativo ni más que la línea entera a precio de lista.
  IF NEW.mecanismo_precio IS DISTINCT FROM 'categoria' OR NEW.categoria_cliente_id IS NULL
     OR NEW.descuento_categoria_monto IS NULL OR NEW.descuento_categoria_monto <= 0 THEN
    NEW.descuento_categoria_monto := NULL;
  ELSIF NEW.precio_lista_unitario IS NOT NULL THEN
    -- Mig 470: tope = lo que la línea quedó por debajo de la lista (antes: la línea entera a lista).
    NEW.descuento_categoria_monto := NULLIF(GREATEST(LEAST(NEW.descuento_categoria_monto,
      round((NEW.precio_lista_unitario - COALESCE(NEW.precio_unitario, 0)) * NEW.cantidad, 2)), 0), 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Reporte F3 ──────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_reporte_descuento_categoria(
  p_desde date, p_hasta date, p_categoria_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL
)
RETURNS TABLE (
  categoria_id uuid, categoria_nombre text, cliente_id uuid, cliente_nombre text,
  ventas bigint, lineas bigint, unidades numeric, monto numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := get_user_tenant_id();
  v_rol    text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin negocio en la sesión'; END IF;
  SELECT u.rol INTO v_rol FROM users u WHERE u.id = auth.uid() AND u.activo IS NOT FALSE;
  IF v_rol IS NULL OR v_rol NOT IN ('DUEÑO', 'ADMIN', 'SUPER_USUARIO', 'SUPERVISOR', 'CONTADOR') THEN
    RAISE EXCEPTION 'Tu rol no puede ver este reporte';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Período inválido'; END IF;
  IF p_hasta - p_desde > 731 THEN RAISE EXCEPTION 'El período no puede superar los dos años'; END IF;

  -- SECURITY INVOKER: la RLS de ventas / venta_items (sucursal) aplica igual que en el resto de los reportes.
  -- Mig 470: una devolución PARCIAL deja la venta 'despachada'/'facturada'; lo devuelto ya no es plata que se dejó de
  -- cobrar. `devolucion_items` no apunta a la línea sino al producto de la venta → se descuenta en proporción a lo
  -- devuelto de ese producto en esa venta (devuelto / vendido, tope 100 %).
  RETURN QUERY
  WITH vendido AS (
    SELECT vi2.venta_id, vi2.producto_id, sum(vi2.cantidad) AS cant
    FROM venta_items vi2 WHERE vi2.tenant_id = v_tenant GROUP BY 1, 2
  ), devuelto AS (
    SELECT d.venta_id, di.producto_id, sum(di.cantidad) AS cant
    FROM devolucion_items di JOIN devoluciones d ON d.id = di.devolucion_id
    WHERE d.tenant_id = v_tenant GROUP BY 1, 2
  )
  SELECT vi.categoria_cliente_id, cat.nombre, v.cliente_id, COALESCE(c.nombre, v.cliente_nombre),
         count(DISTINCT v.id), count(*),
         round(sum(vi.cantidad * (1 - LEAST(COALESCE(dv.cant, 0) / NULLIF(vd.cant, 0), 1))), 2),
         round(sum(vi.descuento_categoria_monto * (1 - LEAST(COALESCE(dv.cant, 0) / NULLIF(vd.cant, 0), 1))), 2)
  FROM venta_items vi
  JOIN ventas v ON v.id = vi.venta_id
  LEFT JOIN vendido vd ON vd.venta_id = vi.venta_id AND vd.producto_id = vi.producto_id
  LEFT JOIN devuelto dv ON dv.venta_id = vi.venta_id AND dv.producto_id = vi.producto_id
  LEFT JOIN categorias_cliente cat ON cat.id = vi.categoria_cliente_id
  LEFT JOIN clientes c ON c.id = v.cliente_id
  WHERE vi.tenant_id = v_tenant AND v.tenant_id = v_tenant
    AND vi.mecanismo_precio = 'categoria' AND COALESCE(vi.descuento_categoria_monto, 0) > 0
    AND v.estado IN ('despachada', 'facturada', 'reservada')   -- no presupuestos, devueltas ni anuladas
    AND (v.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
    AND (p_categoria_id IS NULL OR vi.categoria_cliente_id = p_categoria_id)
    AND (p_cliente_id IS NULL OR v.cliente_id = p_cliente_id)
  GROUP BY vi.categoria_cliente_id, cat.nombre, v.cliente_id, COALESCE(c.nombre, v.cliente_nombre)
  HAVING sum(vi.descuento_categoria_monto * (1 - LEAST(COALESCE(dv.cant, 0) / NULLIF(vd.cant, 0), 1))) > 0
  ORDER BY 8 DESC;
END;
$function$;
