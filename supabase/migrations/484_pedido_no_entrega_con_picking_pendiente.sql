-- 484 · Un pedido no se entrega con el picking pendiente + las tareas colgadas se confirman
--
-- Pedido de GO (2026-10-08). Al rediseñar Pedidos → Tareas WMS apareció trabajo fantasma: pedidos
-- ENTREGADOS con tareas de picking vivas (DEV: 22 pedidos / 44 tareas de e2e; PROD: 0). Causa:
-- `fn_pedido_generar_venta` (entrega de un pedido manual) acepta un pedido "en preparación" aunque
-- el picking no haya terminado. El stock quedaba bien (la entrega consume lo reservado y los LPN
-- quedaron en 0) pero la cola de Depósito mandaba a buscar mercadería que ya se había ido.
--
-- 1) `fn_pedido_generar_venta`: si el pedido tiene picking/reabastecimiento pendiente → no entrega.
--    (`fn_pedido_entregar_retiro` ya exigía "listo para entrega", que solo se alcanza con el
--    picking completo; `fn_pedido_cerrar` parte de entregado_parcial/listo.)
-- 2) Envío entregado (trigger del POD, que por diseño NUNCA bloquea): confirma los pickings
--    pendientes del pedido y cancela los reabastecimientos pendientes.
-- 3) Datos: las tareas vivas de pedidos ya ENTREGADOS se confirman (picking) o cancelan
--    (reabastecimiento), con nota. Completar un picking no mueve stock (solo estado).
--
-- Fuente: pg_get_functiondef de DEV (idéntica a PROD en lógica; el trigger en PROD no tiene los
-- comentarios — mismo cuerpo).

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
  v_motor            jsonb;
  v_desc_u           numeric;
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

  -- (mig 484) No se entrega con el picking a medio hacer: la mercadería que todavía no se pickeó no
  -- salió del depósito, y si se entregaba igual las tareas quedaban vivas en la cola (trabajo fantasma).
  -- Va DESPUÉS de la idempotencia: un reintento de una entrega ya hecha devuelve su venta.
  IF EXISTS (SELECT 1 FROM wms_tareas
             WHERE pedido_id = p_pedido_id AND tipo IN ('picking', 'replenishment')
               AND estado IN ('pendiente', 'en_curso')) THEN
    RAISE EXCEPTION 'Falta completar el picking de este pedido (% tarea(s) pendientes en Depósito). Completalas (o cancelá las que no correspondan) en Picking o en Pedidos → Tareas WMS y volvé a entregarlo.',
      (SELECT count(*) FROM wms_tareas
        WHERE pedido_id = p_pedido_id AND tipo IN ('picking', 'replenishment')
          AND estado IN ('pendiente', 'en_curso'));
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
  -- Mig 442 (decisión de GO): la CC habilitada también la controla el servidor (condición EFECTIVA).
  IF v_tiene_cc AND NOT COALESCE((SELECT e.cc_habilitada FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id), false) THEN
    RAISE EXCEPTION 'El cliente no tiene cuenta corriente habilitada. Cobrá por otro medio.';
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
    -- Mig 468: motor único con el cliente del pedido (categoría). Sin precio del motor no hay venta.
    v_motor := fn_precios_lineas(
      jsonb_build_array(jsonb_build_object('key', v_item.id, 'producto_id', v_item.producto_id, 'cantidad', v_cant_sku)),
      NULL, v_pedido.cliente_id)->'lineas'->0;
    IF v_motor ? 'error' THEN
      RAISE EXCEPTION 'No se pudo calcular el precio de % (SKU %): %', v_producto.nombre, v_producto.sku, v_motor->>'error';
    END IF;
    v_precio := (v_motor->>'precio_unitario')::numeric;
    v_item_subtotal := ROUND(v_precio * v_cant_entregar, 2);
    v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
      THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
      ELSE 0 END;

    INSERT INTO venta_items (
      tenant_id, venta_id, producto_id, cantidad, precio_unitario, precio_costo_historico,
      subtotal, alicuota_iva, iva_monto, pedido_item_id, mecanismo_precio, descuento_categoria_monto
    ) VALUES (
      v_pedido.tenant_id, v_venta_id, v_item.producto_id, v_cant_entregar, v_precio,
      v_producto.precio_costo, v_item_subtotal, COALESCE(v_producto.alicuota_iva, 21), v_iva_monto, v_item.id,
      v_motor->>'mecanismo',
      CASE WHEN v_motor->>'mecanismo' = 'categoria'
        THEN round(GREATEST((v_motor->>'precio_unitario_sin_categoria')::numeric - v_precio, 0) * v_cant_entregar, 2) END
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
        -- Mig 468 (A2): con categoría activa el estado compite contra la lista; sin categoría se acumula (igual que antes).
        v_desc_u := fn_descuento_estado_unitario(v_precio, (v_motor->>'precio_lista')::numeric, v_pct_linea,
                                                 COALESCE((v_motor->>'estado_compite')::boolean, false));
        IF v_desc_u > 0 THEN
          v_desc_monto := v_desc_monto + ROUND(v_desc_u * v_tomar, 2);
          IF v_desc_pct IS NULL THEN
            v_desc_pct := v_pct_linea; v_desc_pcts := 1;
          ELSIF v_desc_pct <> v_pct_linea THEN
            v_desc_pcts := v_desc_pcts + 1;
          END IF;
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
    -- Mig 442: política y límite EFECTIVOS (Cliente > Categoría > Negocio).
    SELECT e.cc_enforcement_politica INTO v_enforcement_pol FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;
    IF v_enforcement_pol = 'bloquear' THEN
      SELECT COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0) INTO v_deuda_total
      FROM ventas v
      WHERE v.cliente_id = v_pedido.cliente_id AND v.tenant_id = v_pedido.tenant_id
        AND v.es_cuenta_corriente = true AND v.estado <> 'cancelada'
        AND (v.total - v.monto_pagado) > 0.5;

      SELECT e.cc_limite INTO v_limite_credito FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;

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


CREATE OR REPLACE FUNCTION public.trg_envio_entregado_sincroniza_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_tenant uuid;
BEGIN
  IF NEW.pedido_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.estado IS DISTINCT FROM 'entregado' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado IS NOT DISTINCT FROM 'entregado' THEN RETURN NEW; END IF;

  -- 🔴 Hallazgo del migration-reviewer: sin este chequeo, al ser SECURITY DEFINER, un envío cuyo
  -- pedido_id apuntara (por error o manipulación) a un pedido de OTRO tenant bypassearía RLS —
  -- mismo chequeo que ya hace `trg_envio_marca_pedido_con_envio` (mig 315) en este módulo.
  SELECT tenant_id INTO v_pedido_tenant FROM pedidos WHERE id = NEW.pedido_id;
  IF v_pedido_tenant IS DISTINCT FROM NEW.tenant_id THEN RETURN NEW; END IF;

  -- Mismo criterio que `fn_pedido_entregar_retiro` (mig 316): marca las líneas como preparadas y
  -- entregadas en su totalidad — un envío entregado es "todo o nada", no hay entrega parcial acá.
  UPDATE pedido_items
     SET cantidad_entregada = cantidad, estado = 'preparado'
   WHERE pedido_id = NEW.pedido_id AND estado <> 'cancelada';

  -- No pisa un pedido ya `entregado` (idempotente) ni uno `cancelado` (la mercadería no debería
  -- haber salido, pero si el dato real dice que se entregó no lo forzamos a un estado inconsistente
  -- con silencio — queda tal cual para revisión manual, no es un caso que deba bloquear el POD).
  -- (mig 484) El envío entregado prueba que la mercadería salió: las tareas de picking que quedaron
  -- pendientes se CONFIRMAN (decisión de GO; completar un picking solo cambia su estado, no mueve
  -- stock) y los reabastecimientos pendientes se CANCELAN (confirmarlos registraría un movimiento de
  -- stock entre ubicaciones que nunca pasó). Solo si el pedido estaba vivo.
  --    Sub-bloque propio: si la limpieza de tareas fallara, NO revierte el paso del pedido a entregado.
  IF EXISTS (SELECT 1 FROM pedidos WHERE id = NEW.pedido_id AND estado NOT IN ('entregado', 'cancelado')) THEN
    BEGIN
      UPDATE wms_tareas
         SET estado = 'completada', completed_at = now(),
             notas = COALESCE(notas || ' — ', '') || 'Confirmada al entregarse el envío #' || COALESCE(NEW.numero::text, '?')
       WHERE pedido_id = NEW.pedido_id AND tenant_id = NEW.tenant_id
         AND tipo = 'picking' AND estado IN ('pendiente', 'en_curso');
      UPDATE wms_tareas
         SET estado = 'cancelada',
             notas = COALESCE(notas || ' — ', '') || 'Cancelada: el envío #' || COALESCE(NEW.numero::text, '?') || ' ya se entregó'
       WHERE pedido_id = NEW.pedido_id AND tenant_id = NEW.tenant_id
         AND tipo = 'replenishment' AND estado IN ('pendiente', 'en_curso');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[trg_envio_entregado_sincroniza_pedido] tareas del pedido % : %', NEW.pedido_id, SQLERRM;
    END;
  END IF;

  UPDATE pedidos
     SET estado = 'entregado', entregado_at = now()
   WHERE id = NEW.pedido_id
     AND estado NOT IN ('entregado', 'cancelado');

  RETURN NEW;
-- Nunca debe bloquear el guardado del POD (prueba de entrega real) por un problema de sincronización
-- del lado de Pedidos — mismo criterio defensivo que `trg_envio_marca_pedido_con_envio` (mig 315).
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_envio_entregado_sincroniza_pedido] envío % pedido % : %', NEW.id, NEW.pedido_id, SQLERRM;
  RETURN NEW;
END;
$function$;


-- 3 · Tareas colgadas de pedidos ya entregados.
UPDATE public.wms_tareas t
   SET estado = 'completada', completed_at = now(),
       notas = COALESCE(t.notas || ' — ', '') || 'Confirmada por mig 484: el pedido ya estaba entregado'
  FROM public.pedidos p
 WHERE p.id = t.pedido_id AND p.estado = 'entregado'
   AND t.tipo = 'picking' AND t.estado IN ('pendiente', 'en_curso');

UPDATE public.wms_tareas t
   SET estado = 'cancelada',
       notas = COALESCE(t.notas || ' — ', '') || 'Cancelada por mig 484: el pedido ya estaba entregado'
  FROM public.pedidos p
 WHERE p.id = t.pedido_id AND p.estado = 'entregado'
   AND t.tipo = 'replenishment' AND t.estado IN ('pendiente', 'en_curso');
