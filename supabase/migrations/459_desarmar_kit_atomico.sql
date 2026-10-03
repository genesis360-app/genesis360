-- 459 — Desarmado de KIT ATÓMICO vía RPC (REGLA #0, inventario)
--
-- Antes: InventarioPage hacía el desarmado con escrituras sueltas desde el navegador (rebaje del KIT línea por
-- línea → movimiento → N inserts de componentes → N movimientos → kitting_log). Problemas:
--   1. No atómico: una falla a mitad dejaba el KIT rebajado sin los componentes ingresados.
--   2. El stock_antes del movimiento 'des_kitting' se leía DESPUÉS del rebaje (antes y después corridos en `cant`).
--   3. El rebaje FIFO no ordenaba las líneas.
--   4. Los errores de movimientos_stock y kitting_log no se miraban (stock movido sin ledger).
--   5. Sin bloqueo: dos desarmados simultáneos pasaban los dos la validación de stock.
--   6. inventario_lineas.cantidad es INTEGER y la receta numeric(12,3): un componente fraccionario (0,5 × 3 = 1,5)
--      se redondeaba en silencio al insertar → stock inventado o perdido. Ahora se rechaza.
--   7. Productos con número de serie: el componente entraba sin series → stock inconsistente. Ahora se rechaza.
-- Los movimientos históricos NO se corrigen (REGLA #0 #7).
--
-- SECURITY INVOKER (como las RPC de armado, mig 244): corre como `authenticated` → la RLS aísla por negocio y el guard
-- de ubicación de la mig 455 aplica a los componentes ingresados (en avanzado, sin ubicación → rechazo).

CREATE OR REPLACE FUNCTION public.desarmar_kit(
  p_kit_producto_id uuid,
  p_cantidad        numeric,
  p_ubicacion_id    uuid,
  p_sucursal_id     uuid,
  p_notas           text
) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid;
  v_avanzado   boolean;
  v_series     boolean;
  rec          RECORD;
  ln           RECORD;
  v_nrecetas   int;
  v_disponible numeric := 0;
  v_restante   numeric;
  v_rebajar    numeric;
  v_antes      numeric;
  v_comp_cant  numeric;
  v_log_id     uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_cantidad <> trunc(p_cantidad) THEN RAISE EXCEPTION 'La cantidad de KITs a desarmar tiene que ser un número entero'; END IF;

  SELECT modo_operacion = 'avanzado' INTO v_avanzado FROM tenants WHERE id = v_tenant;
  IF v_avanzado AND p_ubicacion_id IS NULL THEN
    RAISE EXCEPTION 'Elegí la ubicación de los componentes: en modo avanzado el stock sin ubicación no se puede vender';
  END IF;

  SELECT tiene_series INTO v_series FROM productos WHERE id = p_kit_producto_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'KIT no encontrado'; END IF;
  IF v_series THEN RAISE EXCEPTION 'El desarmado no admite KITs con número de serie'; END IF;

  SELECT count(*) INTO v_nrecetas FROM kit_recetas
    WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id;
  IF v_nrecetas = 0 THEN RAISE EXCEPTION 'El KIT no tiene receta configurada'; END IF;

  -- Validar los componentes ANTES de escribir nada
  FOR rec IN SELECT r.comp_producto_id, r.cantidad, p.nombre, p.tiene_series
             FROM kit_recetas r JOIN productos p ON p.id = r.comp_producto_id
             WHERE r.tenant_id = v_tenant AND r.kit_producto_id = p_kit_producto_id LOOP
    IF rec.tiene_series THEN
      RAISE EXCEPTION 'El componente "%" tiene número de serie: el desarmado no lo admite', rec.nombre;
    END IF;
    v_comp_cant := rec.cantidad * p_cantidad;
    IF v_comp_cant <> trunc(v_comp_cant) THEN
      RAISE EXCEPTION 'El componente "%" daría % unidades: el stock se lleva en unidades enteras. Desarmá una cantidad de KITs que dé un número entero.',
        rec.nombre, trim_scale(v_comp_cant);
    END IF;
  END LOOP;

  -- 1. Bloquear las líneas del KIT (orden determinístico) y validar disponible
  FOR ln IN
    SELECT id, cantidad, COALESCE(cantidad_reservada, 0) AS reservada FROM inventario_lineas
    WHERE tenant_id = v_tenant AND producto_id = p_kit_producto_id AND activo = true
      AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id)
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    v_disponible := v_disponible + GREATEST(0, ln.cantidad - ln.reservada);
  END LOOP;
  IF v_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente del KIT: necesitás %, hay % disponibles', p_cantidad, v_disponible;
  END IF;

  -- 2. Stock ANTES del KIT (en la sucursal, o total si no hay sucursal) y rebaje FIFO
  SELECT COALESCE(sum(cantidad), 0) INTO v_antes FROM inventario_lineas
    WHERE tenant_id = v_tenant AND producto_id = p_kit_producto_id AND activo = true
      AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);

  v_restante := p_cantidad;
  FOR ln IN
    SELECT id, cantidad, COALESCE(cantidad_reservada, 0) AS reservada FROM inventario_lineas
    WHERE tenant_id = v_tenant AND producto_id = p_kit_producto_id AND activo = true
      AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id)
      AND cantidad - COALESCE(cantidad_reservada, 0) > 0
    ORDER BY created_at, id
  LOOP
    EXIT WHEN v_restante <= 0;
    v_rebajar := LEAST(ln.cantidad - ln.reservada, v_restante);
    -- Patrón del rebaje FIFO (mig 309): el LPN que queda en 0 se desactiva.
    UPDATE inventario_lineas
      SET cantidad = cantidad - v_rebajar,
          activo   = (cantidad - v_rebajar) > 0 OR COALESCE(cantidad_reservada, 0) > 0,
          updated_at = now()
      WHERE id = ln.id;
    v_restante := v_restante - v_rebajar;
  END LOOP;

  INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
  VALUES (v_tenant, p_kit_producto_id, 'des_kitting', p_cantidad, v_antes, GREATEST(0, v_antes - p_cantidad),
          COALESCE(NULLIF(p_notas, ''), 'Desarmado x' || p_cantidad), auth.uid(), p_sucursal_id);

  -- 3. Ingreso de cada componente según la receta
  FOR rec IN SELECT comp_producto_id, cantidad FROM kit_recetas
             WHERE tenant_id = v_tenant AND kit_producto_id = p_kit_producto_id
             ORDER BY comp_producto_id LOOP
    v_comp_cant := rec.cantidad * p_cantidad;
    SELECT COALESCE(sum(cantidad), 0) INTO v_antes FROM inventario_lineas
      WHERE tenant_id = v_tenant AND producto_id = rec.comp_producto_id AND activo = true
        AND (p_sucursal_id IS NULL OR sucursal_id = p_sucursal_id);

    INSERT INTO inventario_lineas (tenant_id, producto_id, cantidad, activo, sucursal_id, ubicacion_id)
    VALUES (v_tenant, rec.comp_producto_id, v_comp_cant, true, p_sucursal_id,
            CASE WHEN v_avanzado THEN p_ubicacion_id ELSE NULL END);

    INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, sucursal_id)
    VALUES (v_tenant, rec.comp_producto_id, 'ingreso', v_comp_cant, v_antes, v_antes + v_comp_cant,
            'Desarmado KIT x' || p_cantidad || ' [' || p_kit_producto_id || ']', auth.uid(), p_sucursal_id);
  END LOOP;

  -- 4. Log
  INSERT INTO kitting_log (tenant_id, kit_producto_id, cantidad_kits, ubicacion_id, usuario_id, notas, tipo, estado)
  VALUES (v_tenant, p_kit_producto_id, p_cantidad, p_ubicacion_id, auth.uid(), NULLIF(p_notas, ''), 'desarmado', 'completado')
  RETURNING id INTO v_log_id;
  RETURN v_log_id;
END $function$;

COMMENT ON FUNCTION public.desarmar_kit(uuid, numeric, uuid, uuid, text) IS
  'Mig 459: desarmado de KIT en una transacción (rebaje FIFO del KIT con bloqueo + ingreso de componentes + movimientos + kitting_log). Rechaza cantidades fraccionarias y productos con serie.';

REVOKE ALL ON FUNCTION public.desarmar_kit(uuid, numeric, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desarmar_kit(uuid, numeric, uuid, uuid, text) TO authenticated;
