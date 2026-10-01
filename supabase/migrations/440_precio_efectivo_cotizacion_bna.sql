-- 440 — D-1 fase 2: `fn_precio_venta_efectivo` usa la tasa ÚNICA del sistema
--
-- GO, 2026-09-25 (D-1): todo USD→ARS va al tipo de cambio VENDEDOR DIVISA del BNA del DÍA HÁBIL
-- ANTERIOR (`fn_cotizacion_bna_vigente`, mig 439), una sola tasa en todos lados. Esta función es el
-- motor de precio de Pedidos → venta (`fn_pedido_generar_venta`), espejo SQL del POS, y tenía dos
-- diferencias con él que esta migración cierra:
--
--  1. Los tiers en USD se convertían con `tenants.cotizacion_usd` (dolarapi "oficial" = BNA BILLETE
--     venta, o un valor cargado a mano), mientras el POS usaba COMPRA. Ahora: la tasa vigente del BNA.
--  2. 🐛 Un producto con precio en dólares (`moneda_venta = 'usd'`) se cotizaba a `precio_venta`, el
--     espejo en pesos congelado a la tasa del día en que se editó — el POS, en cambio, recalcula
--     `precio_usd × tasa`. Un pedido de ese producto salía a otro precio que en mostrador. Ahora
--     igual que el POS; sin cotización, error (D5: nunca se inventa una tasa).
--  3. `fn_pedido_generar_venta` no sellaba `ventas.cotizacion_usd` cuando la venta llevaba un producto
--     en dólares (el POS sí) → Dashboard y Rentabilidad la contaban como venta pura en pesos. Ahora la
--     sella con la misma tasa. Única línea que cambia en esa función (definición DEV = PROD verificada).
--
-- Exposición medida el 2026-09-26: PROD 0 productos en USD y 0 tiers en USD (no cambia ningún precio
-- real); DEV 10 productos en USD. Las definiciones de DEV y PROD diferían solo en comentarios; esta
-- las iguala. `tenants.cotizacion_usd*` queda en el schema (histórico) pero ya nada la lee.

CREATE OR REPLACE FUNCTION public.fn_precio_venta_efectivo(p_tenant_id uuid, p_producto_id uuid, p_cantidad numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_precio_lista       numeric;
  v_cotizacion         numeric;
  v_modo               text;
  v_paso               numeric;
  v_t                  RECORD;
  v_precio_u           numeric;
  v_mejor_ligado_precio numeric;
  v_mejor_ligado_cant  numeric;
  v_n_multiplos        numeric;
  v_resto              numeric;
  v_precio_bloque      numeric;
  v_precio_resto       numeric;
  v_precio_final       numeric;
  v_moneda_venta       text;
  v_precio_usd         numeric;
BEGIN
  SELECT COALESCE(precio_venta, 0), moneda_venta, precio_usd
    INTO v_precio_lista, v_moneda_venta, v_precio_usd
  FROM productos WHERE id = p_producto_id AND tenant_id = p_tenant_id;
  IF v_precio_lista IS NULL THEN RETURN 0; END IF;

  -- D-1 fase 2: la UNA tasa USD→ARS del sistema = vendedor divisa BNA del día hábil anterior.
  SELECT c.venta INTO v_cotizacion FROM fn_cotizacion_bna_vigente('USD') c;

  -- Producto con precio en dólares: el precio de lista es precio_usd × tasa, igual que el POS
  -- (VentasPage.agregarProducto). Antes esta función tomaba `precio_venta`, el espejo en pesos
  -- congelado a la tasa del día en que se editó el producto. Sin tasa, se frena (D5).
  IF v_moneda_venta = 'usd' AND COALESCE(v_precio_usd, 0) > 0 THEN
    IF COALESCE(v_cotizacion, 0) <= 0 THEN
      RAISE EXCEPTION 'El producto tiene precio en dólares y no hay cotización del dólar BNA';
    END IF;
    v_precio_lista := round(v_precio_usd * v_cotizacion, 2);
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN v_precio_lista; END IF;

  v_mejor_ligado_precio := NULL;

  -- Tiers ENLAZADOS a una presentación de empaque: cantidad_minima se compara contra MÚLTIPLOS
  -- completos (floor(cantidad total / factor_base)), no contra unidades sueltas.
  FOR v_t IN
    SELECT ppm.cantidad_minima, ppm.precio, ppm.operador, ppm.tipo_valor, pp.factor_base
    FROM producto_precios_mayorista ppm
    JOIN producto_presentaciones pp ON pp.id = ppm.presentacion_id
    WHERE ppm.tenant_id = p_tenant_id AND ppm.producto_id = p_producto_id
      AND ppm.presentacion_id IS NOT NULL AND pp.factor_base > 0
  LOOP
    CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
    v_n_multiplos := floor(p_cantidad / v_t.factor_base);
    CONTINUE WHEN v_n_multiplos < 1;
    IF (CASE v_t.operador
          WHEN '>'  THEN v_n_multiplos >  v_t.cantidad_minima
          WHEN '<'  THEN v_n_multiplos <  v_t.cantidad_minima
          WHEN '='  THEN v_n_multiplos =  v_t.cantidad_minima
          WHEN '>=' THEN v_n_multiplos >= v_t.cantidad_minima
          WHEN '<=' THEN v_n_multiplos <= v_t.cantidad_minima
          ELSE false END)
    THEN
      v_precio_u := CASE
        WHEN v_t.tipo_valor = 'pct'
          THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
        WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
          THEN round(v_t.precio * v_cotizacion, 2)
        WHEN v_t.tipo_valor = 'usd'
          THEN v_precio_lista
        ELSE v_t.precio END;
      IF v_mejor_ligado_precio IS NULL OR v_precio_u < v_mejor_ligado_precio THEN
        v_mejor_ligado_precio := v_precio_u;
        v_mejor_ligado_cant := v_n_multiplos * v_t.factor_base;
      END IF;
    END IF;
  END LOOP;

  IF v_mejor_ligado_precio IS NULL THEN
    -- Sin bloque de empaque: comportamiento de SIEMPRE — gana el primer tier normal que matchea.
    v_precio_final := v_precio_lista;
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF (CASE v_t.operador
            WHEN '>'  THEN p_cantidad >  v_t.cantidad_minima
            WHEN '<'  THEN p_cantidad <  v_t.cantidad_minima
            WHEN '='  THEN p_cantidad =  v_t.cantidad_minima
            WHEN '>=' THEN p_cantidad >= v_t.cantidad_minima
            WHEN '<=' THEN p_cantidad <= v_t.cantidad_minima
            ELSE false END)
      THEN
        v_precio_final := CASE
          WHEN v_t.tipo_valor = 'pct'
            THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
          WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
            THEN round(v_t.precio * v_cotizacion, 2)
          WHEN v_t.tipo_valor = 'usd'
            THEN v_precio_lista
          ELSE v_t.precio END;
        EXIT;
      END IF;
    END LOOP;
  ELSE
    -- El bloque de empaque compite contra el mejor tier NORMAL que también matchee esa cantidad.
    v_precio_bloque := v_mejor_ligado_precio;
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF (CASE v_t.operador
            WHEN '>'  THEN v_mejor_ligado_cant >  v_t.cantidad_minima
            WHEN '<'  THEN v_mejor_ligado_cant <  v_t.cantidad_minima
            WHEN '='  THEN v_mejor_ligado_cant =  v_t.cantidad_minima
            WHEN '>=' THEN v_mejor_ligado_cant >= v_t.cantidad_minima
            WHEN '<=' THEN v_mejor_ligado_cant <= v_t.cantidad_minima
            ELSE false END)
      THEN
        v_precio_u := CASE
          WHEN v_t.tipo_valor = 'pct'
            THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
          WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
            THEN round(v_t.precio * v_cotizacion, 2)
          WHEN v_t.tipo_valor = 'usd'
            THEN v_precio_lista
          ELSE v_t.precio END;
        IF v_precio_u < v_precio_bloque THEN v_precio_bloque := v_precio_u; END IF;
        EXIT;
      END IF;
    END LOOP;

    v_resto := p_cantidad - v_mejor_ligado_cant;
    v_precio_resto := v_precio_lista;
    IF v_resto > 0 THEN
      FOR v_t IN
        SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
        WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
        ORDER BY orden
      LOOP
        CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
        IF (CASE v_t.operador
              WHEN '>'  THEN v_resto >  v_t.cantidad_minima
              WHEN '<'  THEN v_resto <  v_t.cantidad_minima
              WHEN '='  THEN v_resto =  v_t.cantidad_minima
              WHEN '>=' THEN v_resto >= v_t.cantidad_minima
              WHEN '<=' THEN v_resto <= v_t.cantidad_minima
              ELSE false END)
        THEN
          v_precio_resto := CASE
            WHEN v_t.tipo_valor = 'pct'
              THEN round(v_precio_lista * (1 - LEAST(100, GREATEST(0, v_t.precio)) / 100), 2)
            WHEN v_t.tipo_valor = 'usd' AND v_cotizacion > 0
              THEN round(v_t.precio * v_cotizacion, 2)
            WHEN v_t.tipo_valor = 'usd'
              THEN v_precio_lista
            ELSE v_t.precio END;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    v_precio_final := round((v_mejor_ligado_cant * v_precio_bloque + GREATEST(v_resto, 0) * v_precio_resto) / p_cantidad, 2);
  END IF;

  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = p_tenant_id;
  v_paso := CASE v_modo WHEN '10' THEN 10 WHEN '50' THEN 50 WHEN '100' THEN 100
                        WHEN '500' THEN 500 WHEN '1000' THEN 1000 ELSE 0 END;
  IF v_paso > 0 AND v_precio_final > 0 THEN v_precio_final := round(v_precio_final / v_paso) * v_paso; END IF;
  RETURN v_precio_final;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pedido_generar_venta(p_pedido_id uuid, p_sesion_caja_id uuid, p_medio_pago jsonb, p_entregas jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido          RECORD;
  v_sesion          RECORD;
  v_venta_existente uuid;
  v_item            RECORD;
  v_cant_entregar    numeric;
  v_cant_override    numeric;
  v_venta_id         uuid;
  v_subtotal         numeric := 0;
  v_total            numeric := 0;
  v_producto         RECORD;
  v_precio           numeric;
  v_cant_sku         numeric;
  v_desc_monto       numeric;
  v_desc_pct         numeric;
  v_desc_pcts        integer;
  v_pct_linea        numeric;
  v_iva_monto        numeric;
  v_item_subtotal    numeric;
  v_venta_item_id    uuid;
  v_linea            RECORD;
  v_restante         numeric;
  v_tomar            numeric;
  v_stock_antes      numeric;
  v_stock_despues    numeric;
  v_todo_entregado   boolean := true;
  v_hubo_entrega     boolean := false;
  v_cierre_auto      boolean;
  v_monto_efectivo   numeric := 0;
  v_monto_pagado     numeric := 0;
  v_monto_cc         numeric := 0;
  v_mp               jsonb;
  v_tiene_cc         boolean := false;
  v_traza_on         boolean;
  v_deuda_total      numeric;
  v_limite_credito   numeric;
  v_enforcement_pol  text;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_venta_existente FROM ventas
    WHERE pedido_id = p_pedido_id AND pedido_entrega_key = p_idempotency_key;
    IF v_venta_existente IS NOT NULL THEN RETURN v_venta_existente; END IF;
  END IF;

  IF v_pedido.estado NOT IN ('en_preparacion', 'listo_para_entrega', 'entregado_parcial') THEN
    RAISE EXCEPTION 'El pedido tiene que estar lanzado (en preparación, listo para entrega, o entregado parcial) para generar la venta';
  END IF;

  SELECT * INTO v_sesion FROM caja_sesiones WHERE id = p_sesion_caja_id FOR UPDATE;
  IF v_sesion IS NULL OR v_sesion.tenant_id <> v_pedido.tenant_id OR v_sesion.estado <> 'abierta' THEN
    RAISE EXCEPTION 'No hay una caja abierta válida para registrar el ingreso — abrí una caja antes de generar la venta';
  END IF;
  IF v_sesion.sucursal_id IS NOT NULL AND v_pedido.sucursal_id IS NOT NULL AND v_sesion.sucursal_id <> v_pedido.sucursal_id THEN
    RAISE EXCEPTION 'La caja elegida es de otra sucursal — elegí una caja abierta de la sucursal del pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') = 'Cuenta Corriente' THEN v_tiene_cc := true; END IF;
  END LOOP;
  IF v_tiene_cc AND v_pedido.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere un cliente identificado en el pedido';
  END IF;

  SELECT trazabilidad_asignacion INTO v_traza_on FROM tenants WHERE id = v_pedido.tenant_id;

  INSERT INTO ventas (
    tenant_id, cliente_id, cliente_nombre, cliente_telefono, consumidor_final, estado,
    subtotal, total, medio_pago, monto_pagado, es_cuenta_corriente, usuario_id, sucursal_id,
    origen, pedido_id, pedido_entrega_key, despachado_at
  ) VALUES (
    v_pedido.tenant_id, v_pedido.cliente_id,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_nombre END,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_telefono END,
    (v_pedido.cliente_id IS NULL), 'despachada', 0, 0, COALESCE(p_medio_pago, '[]'::jsonb)::text, 0,
    v_tiene_cc, auth.uid(), v_pedido.sucursal_id, 'Pedidos', p_pedido_id, p_idempotency_key, now()
  ) RETURNING id INTO v_venta_id;

  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, pi.cantidad, pi.cantidad_entregada,
           (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    v_cant_entregar := v_item.pendiente;
    IF p_entregas IS NOT NULL THEN
      v_cant_override := NULL;
      SELECT (e->>'cantidad')::numeric INTO v_cant_override
      FROM jsonb_array_elements(p_entregas) e
      WHERE (e->>'pedido_item_id')::uuid = v_item.id;
      IF v_cant_override IS NOT NULL THEN
        v_cant_entregar := LEAST(v_cant_override, v_item.pendiente);
      ELSE
        v_cant_entregar := 0;
      END IF;
    END IF;

    IF v_cant_entregar IS NULL OR v_cant_entregar <= 0 THEN
      IF v_item.pendiente > 0 THEN v_todo_entregado := false; END IF;
      CONTINUE;
    END IF;

    SELECT nombre, sku, precio_venta, precio_costo, alicuota_iva INTO v_producto
    FROM productos WHERE id = v_item.producto_id;
    SELECT COALESCE(SUM(pi2.cantidad), v_cant_entregar) INTO v_cant_sku
    FROM pedido_items pi2
    WHERE pi2.pedido_id = p_pedido_id AND pi2.producto_id = v_item.producto_id
      AND pi2.estado <> 'cancelada';
    v_precio := fn_precio_venta_efectivo(v_pedido.tenant_id, v_item.producto_id, v_cant_sku);
    v_item_subtotal := ROUND(v_precio * v_cant_entregar, 2);
    v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
      THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
      ELSE 0 END;

    INSERT INTO venta_items (
      tenant_id, venta_id, producto_id, cantidad, precio_unitario, precio_costo_historico,
      subtotal, alicuota_iva, iva_monto, pedido_item_id
    ) VALUES (
      v_pedido.tenant_id, v_venta_id, v_item.producto_id, v_cant_entregar, v_precio,
      v_producto.precio_costo, v_item_subtotal, COALESCE(v_producto.alicuota_iva, 21), v_iva_monto, v_item.id
    ) RETURNING id INTO v_venta_item_id;

    v_subtotal := v_subtotal + v_item_subtotal;
    v_total := v_total + v_item_subtotal;

    v_desc_monto := 0; v_desc_pct := NULL; v_desc_pcts := 0;
    v_restante := v_cant_entregar;
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.ubicacion_id, il.lpn, il.estado_id
      FROM inventario_lineas il
      WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
        AND il.activo = true AND COALESCE(il.cantidad_reservada, 0) > 0
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
        AND (v_item.talle IS NULL OR il.talle = v_item.talle)
        AND (v_item.color IS NULL OR il.color = v_item.color)
        AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
        AND (v_item.formato IS NULL OR il.formato = v_item.formato)
        AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE OF il SKIP LOCKED
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      SELECT ei.descuento_pct INTO v_pct_linea
      FROM estados_inventario ei WHERE ei.id = v_linea.estado_id;
      IF COALESCE(v_pct_linea, 0) > 0 THEN
        v_desc_monto := v_desc_monto + ROUND(v_precio * v_tomar * v_pct_linea / 100, 2);
        IF v_desc_pct IS NULL THEN
          v_desc_pct := v_pct_linea; v_desc_pcts := 1;
        ELSIF v_desc_pct <> v_pct_linea THEN
          v_desc_pcts := v_desc_pcts + 1;
        END IF;
      END IF;

      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_antes FROM inventario_lineas
        WHERE tenant_id = v_pedido.tenant_id AND producto_id = v_item.producto_id AND activo = true
          AND (v_pedido.sucursal_id IS NULL OR sucursal_id = v_pedido.sucursal_id);

      UPDATE inventario_lineas
        SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
            activo = (cantidad - v_tomar) > 0
        WHERE id = v_linea.id;

      v_stock_despues := v_stock_antes - v_tomar;

      INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, venta_id, sucursal_id, linea_id)
      VALUES (v_pedido.tenant_id, v_item.producto_id, 'rebaje', v_tomar, v_stock_antes, v_stock_despues,
              'Pedido #' || v_pedido.numero, auth.uid(), v_venta_id, v_pedido.sucursal_id, v_linea.id);

      IF COALESCE(v_traza_on, true) THEN
        INSERT INTO venta_item_despachos (tenant_id, venta_id, venta_item_id, producto_id, linea_id, lpn, ubicacion_id, cantidad, origen)
        VALUES (v_pedido.tenant_id, v_venta_id, v_venta_item_id, v_item.producto_id, v_linea.id, v_linea.lpn, v_linea.ubicacion_id, v_tomar, 'auto');
      END IF;

      v_restante := v_restante - v_tomar;
    END LOOP;

    IF v_restante > 0 THEN
      RAISE EXCEPTION 'No hay stock reservado suficiente para entregar % (SKU %) — faltan % unidades. ¿Se lanzó el pedido?',
        v_producto.nombre, v_producto.sku, v_restante;
    END IF;

    IF v_desc_monto > 0 THEN
      v_item_subtotal := GREATEST(v_item_subtotal - v_desc_monto, 0);
      v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
        THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
        ELSE 0 END;
      UPDATE venta_items
         SET subtotal = v_item_subtotal,
             iva_monto = v_iva_monto,
             descuento_estado_pct = CASE WHEN v_desc_pcts = 1 THEN v_desc_pct ELSE NULL END,
             descuento_estado_monto = v_desc_monto
       WHERE id = v_venta_item_id;
      v_subtotal := v_subtotal - v_desc_monto;
      v_total    := v_total    - v_desc_monto;
    END IF;

    UPDATE pedido_items SET
      cantidad_entregada = cantidad_entregada + v_cant_entregar,
      estado = CASE WHEN (cantidad_entregada + v_cant_entregar) >= cantidad THEN 'preparado' ELSE estado END
    WHERE id = v_item.id;

    v_hubo_entrega := true;
    IF (v_item.cantidad_entregada + v_cant_entregar) < v_item.cantidad THEN v_todo_entregado := false; END IF;
  END LOOP;

  IF NOT v_hubo_entrega THEN
    RAISE EXCEPTION 'No hay nada pendiente de entregar en este pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_monto_pagado := v_monto_pagado + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      IF EXISTS (SELECT 1 FROM metodos_pago WHERE tenant_id = v_pedido.tenant_id AND nombre = (v_mp->>'tipo') AND es_efectivo = true) THEN
        v_monto_efectivo := v_monto_efectivo + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      END IF;
    ELSE
      v_monto_cc := v_monto_cc + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
    END IF;
  END LOOP;
  v_monto_pagado := LEAST(v_monto_pagado, v_total);
  v_monto_cc := LEAST(v_monto_cc, v_total);

  IF v_tiene_cc AND (v_total - v_monto_pagado) > 0.5 THEN
    SELECT COALESCE(cc_enforcement_politica, 'avisar') INTO v_enforcement_pol FROM tenants WHERE id = v_pedido.tenant_id;
    IF v_enforcement_pol = 'bloquear' THEN
      SELECT COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0) INTO v_deuda_total
      FROM ventas v
      WHERE v.cliente_id = v_pedido.cliente_id AND v.tenant_id = v_pedido.tenant_id
        AND v.es_cuenta_corriente = true AND v.estado <> 'cancelada'
        AND (v.total - v.monto_pagado) > 0.5;

      SELECT COALESCE(c.limite_credito, t.limite_cc_default) INTO v_limite_credito
      FROM clientes c, tenants t WHERE c.id = v_pedido.cliente_id AND t.id = v_pedido.tenant_id;

      IF v_limite_credito IS NOT NULL AND (v_deuda_total + (v_total - v_monto_pagado)) > v_limite_credito + 0.5 THEN
        RAISE EXCEPTION 'Esta venta deja la cuenta corriente en $% — supera el límite de $%',
          ROUND(v_deuda_total + (v_total - v_monto_pagado), 0), ROUND(v_limite_credito, 0);
      END IF;
    END IF;
  END IF;

  -- D-1 fase 2 (mig 440): igual que el POS, si la venta lleva un producto con precio en dólares se
  -- sella la tasa con la que se convirtió (`ventas.cotizacion_usd`, mig 368). Dashboards y
  -- Rentabilidad separan por esa marca las ventas con componente en USD.
  UPDATE ventas SET subtotal = v_subtotal, total = v_total, monto_pagado = v_monto_pagado,
         cotizacion_usd = CASE WHEN EXISTS (
           SELECT 1 FROM venta_items vi JOIN productos pr ON pr.id = vi.producto_id
           WHERE vi.venta_id = v_venta_id AND pr.moneda_venta = 'usd' AND COALESCE(pr.precio_usd, 0) > 0
         ) THEN (SELECT c.venta FROM fn_cotizacion_bna_vigente('USD') c) END
   WHERE id = v_venta_id;

  IF v_monto_efectivo > 0.005 THEN
    INSERT INTO caja_movimientos (tenant_id, sesion_id, tipo, concepto, monto, usuario_id)
    VALUES (v_pedido.tenant_id, p_sesion_caja_id, 'ingreso', 'Pedido #' || v_pedido.numero, v_monto_efectivo, auth.uid());
  END IF;

  SELECT COALESCE(pedido_cierre_automatico, true) INTO v_cierre_auto FROM tenants WHERE id = v_pedido.tenant_id;
  IF v_todo_entregado AND v_cierre_auto THEN
    UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;
  ELSE
    UPDATE pedidos SET estado = 'entregado_parcial' WHERE id = p_pedido_id;
  END IF;

  RETURN v_venta_id;
END;
$function$;
