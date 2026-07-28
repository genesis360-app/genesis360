-- ============================================================
-- 299_pedidos_cc_morosidad.sql
-- Módulo Pedidos — cierra el gap documentado desde PED4: Cuenta Corriente como medio de pago
-- en `fn_pedido_generar_venta` no validaba límite de crédito (B1).
--
-- El `migration-reviewer` encontró, en una primera versión de esta migración, que YA EXISTE un
-- guard server-side genérico para esto: el trigger `trg_ventas_cc_guard`/`fn_ventas_cc_guard`
-- (mig 234, `BEFORE INSERT ON ventas`) — corre para CUALQUIER insert en `ventas`, incluidas las
-- que genera Pedidos. Para B4 (morosidad) ese trigger YA es un backstop robusto (calcula la
-- deuda inline por `tenant_id`, sin depender de `auth.uid()`) — por eso esta versión de la
-- migración DEJA DE duplicar el chequeo de morosidad en `fn_pedido_generar_venta` (la primera
-- versión sí lo hacía, vía la RPC `cliente_cc_estado`, que depende de `auth.uid()` — el
-- `migration-reviewer` marcó que es el mismo patrón que la propia mig 234 evitó a propósito).
--
-- Para B1 (límite de crédito) el trigger de la mig 234 SÍ tiene un punto ciego real y
-- confirmado con Pedidos: calcula `monto_cc` leyendo `NEW.medio_pago` en el momento del INSERT,
-- pero `fn_pedido_generar_venta` inserta la cabecera de `ventas` con `total=0`/`monto_pagado=0`
-- (los totales recién se conocen al final, tras sumar las líneas) Y el medio de pago de Pedidos
-- siempre manda `monto: null` (`PedidosPage.tsx`, "null = cobra el total, se resuelve después")
-- — el trigger interpreta ese `null` como 0, así que su propio chequeo de límite queda siempre
-- en 0 para ventas generadas desde Pedidos. Por eso esta migración SÍ agrega el chequeo de B1,
-- pero DENTRO de `fn_pedido_generar_venta`, en el momento en que el total ya se conoce de verdad
-- — calculando la deuda INLINE escopeada por `tenant_id` (mismo criterio que `fn_ventas_cc_guard`,
-- NO vía `cliente_cc_estado`, para no heredar la dependencia de `auth.uid()`).
--
-- 🔴 Fix adicional encontrado por el `migration-reviewer`: sin clampear cada monto individual a
-- `GREATEST(x, 0)`, un usuario autenticado del tenant podía invocar el RPC directamente (no solo
-- desde la UI) con una entrada `Cuenta Corriente` de monto NEGATIVO para neutralizar el chequeo
-- de límite (`v_monto_cc` quedaba en 0 o negativo, el `IF v_monto_cc > 0.5` nunca se cumplía,
-- aunque la deuda real que queda grabada en `ventas.total - monto_pagado` no dependía de ese
-- cálculo — evadía el CONTROL, no falseaba la deuda en sí). Corregido clampeando cada entrada.
--
-- Política 'avisar' (B1) tratada como "permitir" acá a propósito — depende de un `confirm()`
-- interactivo del navegador que no existe en un contexto 100% server-side; solo se replican los
-- bloqueos DUROS ('bloquear'), igual criterio que ya usa el propio trigger de la mig 234.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pedido_generar_venta(
  p_pedido_id         uuid,
  p_sesion_caja_id    uuid,
  p_medio_pago        jsonb,
  p_entregas          jsonb DEFAULT NULL,
  p_idempotency_key   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
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

  -- Idempotencia: un reintento de red con la misma key devuelve la venta ya generada.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_venta_existente FROM ventas
    WHERE pedido_id = p_pedido_id AND pedido_entrega_key = p_idempotency_key;
    IF v_venta_existente IS NOT NULL THEN RETURN v_venta_existente; END IF;
  END IF;

  IF v_pedido.estado NOT IN ('en_preparacion', 'listo_para_entrega', 'entregado_parcial') THEN
    RAISE EXCEPTION 'El pedido tiene que estar lanzado (en preparación, listo para entrega, o entregado parcial) para generar la venta';
  END IF;

  -- FOR UPDATE: bloquea la sesión durante toda la función (evita que se cierre en el medio,
  -- ventana TOCTOU) + valida que sea de la misma sucursal del pedido (o sin sucursal fija).
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
  -- B4 (morosidad) NO se duplica acá — ya la garantiza `trg_ventas_cc_guard`/`fn_ventas_cc_guard`
  -- (mig 234, BEFORE INSERT ON ventas), que corre para el INSERT de más abajo sin depender de
  -- auth.uid() (calcula la deuda inline por tenant_id). Ver comentario de cabecera.

  SELECT trazabilidad_asignacion INTO v_traza_on FROM tenants WHERE id = v_pedido.tenant_id;

  -- venta header: subtotal/total se completan al final (recién se conocen tras el loop). El
  -- trigger de la mig 234 corre acá mismo (BEFORE INSERT) y valida morosidad — puede abortar.
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
        v_cant_entregar := 0; -- se pasó p_entregas explícito y esta línea no está incluida
      END IF;
    END IF;

    IF v_cant_entregar IS NULL OR v_cant_entregar <= 0 THEN
      IF v_item.pendiente > 0 THEN v_todo_entregado := false; END IF;
      CONTINUE;
    END IF;

    SELECT nombre, sku, precio_venta, precio_costo, alicuota_iva INTO v_producto
    FROM productos WHERE id = v_item.producto_id;
    v_precio := COALESCE(v_producto.precio_venta, 0);
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
    v_total := v_total + v_item_subtotal; -- Pedidos no aplica descuentos (H1)

    -- Rebaje real: consumir de líneas YA RESERVADAS (mismo mecanismo que "despachar una
    -- reserva" de Ventas — FEFO sobre lo reservado, no sobre lo disponible en general).
    v_restante := v_cant_entregar;
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.ubicacion_id, il.lpn
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

  -- Monto pagado + efectivo a caja + monto CC (mismo criterio de auto-completar que
  -- registrarVenta: un único medio sin monto especificado cobra el total). Cada entrada se
  -- clampea a GREATEST(x, 0) — un monto negativo no debe poder "restar" del total ni neutralizar
  -- el chequeo de límite de crédito de más abajo.
  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_monto_pagado := v_monto_pagado + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      IF (v_mp->>'tipo') = 'Efectivo' THEN
        v_monto_efectivo := v_monto_efectivo + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      END IF;
    ELSE
      v_monto_cc := v_monto_cc + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
    END IF;
  END LOOP;
  v_monto_pagado := LEAST(v_monto_pagado, v_total);
  v_monto_cc := LEAST(v_monto_cc, v_total);

  -- B1 — Límite de crédito: solo si esta venta suma de verdad a CC y el tenant exige bloquear
  -- ('avisar' depende de un confirm() interactivo que acá no existe, ver cabecera). Deuda
  -- calculada INLINE escopeada por tenant_id (mismo criterio que fn_ventas_cc_guard, mig 234 —
  -- NO vía cliente_cc_estado, que depende de auth.uid()).
  --
  -- 🔴 Segundo fix del migration-reviewer sobre esta migración: el GATE de esta validación no
  -- puede depender de `v_monto_cc` (un valor que el llamante controla vía `p_medio_pago` — una
  -- sola entrada 'Cuenta Corriente' con `monto` 0 o negativo clampea a 0 y evade el chequeo
  -- ENTERO, aunque `es_cuenta_corriente` quede en `true` y la venta genere igual la deuda real).
  -- En cambio, se usa `v_total - v_monto_pagado` (el saldo real sin cubrir de ESTA venta): ambos
  -- términos ya están defendidos (`v_total` sale de `productos.precio_venta` en DB, no del
  -- llamante; `v_monto_pagado` está clampeado y capado con `LEAST(...,v_total)`) — no importa
  -- qué diga el medio de pago, lo que no cubran los medios NO-CC se vuelve deuda CC real de
  -- todos modos, y es ESO lo que hay que chequear contra el límite, no lo que el JSON afirme.
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

  UPDATE ventas SET subtotal = v_subtotal, total = v_total, monto_pagado = v_monto_pagado WHERE id = v_venta_id;

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
$$;

REVOKE ALL ON FUNCTION fn_pedido_generar_venta(uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_generar_venta(uuid, uuid, jsonb, jsonb, uuid) TO authenticated, service_role;
