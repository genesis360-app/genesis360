-- ============================================================
-- 295_pedidos_ped4_entrega.sql
-- Módulo Pedidos — PED4 (cumplimiento parcial → genera la venta REAL). Ver
-- G360.Wiki/sources/raw/relevamiento_pedidos_respuestas.md secciones A/G/H.
--
-- A1/H1 (decisión ya confirmada con GO): Pedidos NUNCA pasa por el POS/`registrarVenta()`.
-- `fn_pedido_generar_venta` reusa SOLO la mecánica de rebaje/movimientos que ya usa Ventas
-- (mismo patrón: `inventario_lineas`/`movimientos_stock`/`venta_item_despachos`/
-- `caja_movimientos`), sin arrastrar promos/combos/series/CC-morosidad/descuentos del POS —
-- Pedidos no los necesita (H1: sin precio en `pedido_items`, precio de lista al entregar).
-- La factura AFIP NO se emite automáticamente acá — se deja para el flujo "Facturar" ya
-- existente en Ventas → Historial (`emitirFactura` en VentasPage.tsx, EF `emitir-factura`),
-- que ya funciona sobre cualquier venta por `venta_id` sin importar cómo se creó. Esto evita
-- reimplementar la lógica fiscal (Regla de oro #0: un solo lugar calcula/emite comprobantes).
--
-- G1-G3 (cumplimiento parcial): `p_entregas` permite entregar menos que el total pedido por
-- línea; lo no entregado queda pendiente para una entrega posterior (N ventas por Pedido, A4).
-- G4 (cierre automático/manual): `tenants.pedido_cierre_automatico` — si TRUE (default) y se
-- completa el 100%, el pedido pasa solo a 'entregado'; si FALSE, queda en 'entregado_parcial'
-- hasta que alguien lo cierre a mano (`fn_pedido_cerrar`).
--
-- REGLA #0 — efectivo SIEMPRE a caja: a diferencia del patrón de VentasPage (que tolera que
-- el insert en `caja_movimientos` falle dejando la venta igual, con un toast de aviso), acá
-- el insert de caja va DENTRO de la misma transacción de la función: si falla, se aborta TODA
-- la operación (nada de venta/rebaje a medias sin su correlato en caja). Es más estricto que
-- el POS a propósito — no hay una UI viva mostrando el toast de "asentalo a mano" en un flujo
-- de depósito, así que fallar entero es más seguro que dejar plata sin asentar.
--
-- Fix aplicado en esta misma migración (mismo hallazgo que encontró el migration-reviewer en
-- la mig 294, aplicado acá preventivamente): la consulta que consume
-- `inventario_lineas.cantidad_reservada` para el rebaje filtra también por
-- talle/color/encaje/formato/sabor_aroma de la línea del pedido — sin esto, si el mismo
-- producto tenía OTRA línea reservada por una venta de mostrador no relacionada (con distinto
-- atributo), esta función podía consumir esa reserva ajena en vez de la propia del pedido
-- (peor que el hallazgo de la mig 294: acá robaría stock reservado de otro documento, no solo
-- entregaría la variante equivocada).
--
-- Revisado por el subagente migration-reviewer — 3 hallazgos reales corregidos en esta misma
-- migración antes de aplicar:
--   1) 🔴 El guard de estado no incluía `'entregado_parcial'` → la SEGUNDA entrega de
--      cualquier pedido con cumplimiento parcial (G1-G3, el caso central de esta fase) fallaba
--      siempre con "El pedido tiene que estar lanzado...". Corregido: se agrega el estado.
--   2) 🔴 Sin ese fix, un reintento de red (commit exitoso pero el cliente no vio la respuesta)
--      quedaba protegido por accidente por el guard roto; al arreglar (1) hacía falta blindar
--      el reintento de verdad → se agrega `p_idempotency_key` (mismo criterio que
--      `crypto.randomUUID()` client-side ya usado en el proyecto para otros casos e idempotencia
--      "chequear EXISTS antes de generar" que ya usa `fn_generar_tareas_picking_pedido`, mig 294):
--      si ya existe una venta con esa `(pedido_id, pedido_entrega_key)`, se devuelve esa venta_id
--      sin volver a rebajar/cobrar.
--   3) 🟡 Ventana TOCTOU en la sesión de caja: se agrega `FOR UPDATE` al chequeo (bloquea la
--      sesión durante toda la función) y se valida que su `sucursal_id` coincida con la del
--      pedido (o sea NULL) para no asentar el ingreso en la caja de otra sucursal.
-- El hallazgo más severo del review (🔴 "pool fungible de reservas": al completar un
-- reabastecimiento encadenado, mig 290 `fn_completar_tarea_reabastecimiento` decrementaba
-- `cantidad` en el origen pero nunca transfería `cantidad_reservada` al LPN nuevo del destino,
-- dejando la reserva "pegada" en un origen que después de moverse puede tener menos stock físico
-- del que aparenta, mientras el LPN de picking recién creado queda SIN reserva —"stock fantasma")
-- se corrige en la migración separada `297_wms_reabastecimiento_transferir_reserva.sql`
-- (corrección de una función ya compartida por envío/pedido/umbral, no específica de Pedidos —
-- aplicar esa migración ANTES de probar el camino "reabastecimiento → entrega" de Pedidos).
-- Pendiente NO bloqueante, documentado para retomar: CC en Pedidos no valida morosidad/límite de
-- crédito (Ventas sí lo hace, aunque solo client-side) — ver wiki/features/pedidos.md.
-- ============================================================

-- ── 1) tenants.pedido_cierre_automatico (G4) ───────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pedido_cierre_automatico boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN tenants.pedido_cierre_automatico IS
  'G4: si TRUE (default), un Pedido pasa solo a estado ''entregado'' al completar el 100% de sus líneas. Si FALSE, queda en ''entregado_parcial'' hasta cerrarlo a mano (fn_pedido_cerrar).';

-- ── 1b) ventas.pedido_entrega_key — idempotencia de reintentos de red ──────────────────
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS pedido_entrega_key uuid;
COMMENT ON COLUMN ventas.pedido_entrega_key IS
  'Idempotency key (crypto.randomUUID() client-side) para fn_pedido_generar_venta — un reintento de red con la misma key devuelve la venta ya creada en vez de duplicar rebaje/caja.';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_pedido_entrega_key
  ON ventas (pedido_id, pedido_entrega_key) WHERE pedido_entrega_key IS NOT NULL;

-- ── 2) fn_pedido_generar_venta — genera la venta real (rebaje + caja), NO la factura ───
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
  v_pedido         RECORD;
  v_sesion         RECORD;
  v_venta_existente uuid;
  v_item           RECORD;
  v_cant_entregar  numeric;
  v_cant_override  numeric;
  v_venta_id       uuid;
  v_subtotal       numeric := 0;
  v_total          numeric := 0;
  v_producto       RECORD;
  v_precio         numeric;
  v_iva_monto      numeric;
  v_item_subtotal  numeric;
  v_venta_item_id  uuid;
  v_linea          RECORD;
  v_restante       numeric;
  v_tomar          numeric;
  v_stock_antes    numeric;
  v_stock_despues  numeric;
  v_todo_entregado boolean := true;
  v_hubo_entrega   boolean := false;
  v_cierre_auto    boolean;
  v_monto_efectivo numeric := 0;
  v_monto_pagado   numeric := 0;
  v_mp             jsonb;
  v_tiene_cc       boolean := false;
  v_traza_on       boolean;
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

  SELECT trazabilidad_asignacion INTO v_traza_on FROM tenants WHERE id = v_pedido.tenant_id;

  -- venta header: subtotal/total se completan al final (recién se conocen tras el loop)
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

  -- Monto pagado + efectivo a caja (mismo criterio de auto-completar que registrarVenta: un
  -- único medio sin monto especificado cobra el total).
  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_monto_pagado := v_monto_pagado + COALESCE((v_mp->>'monto')::numeric, v_total);
      IF (v_mp->>'tipo') = 'Efectivo' THEN
        v_monto_efectivo := v_monto_efectivo + COALESCE((v_mp->>'monto')::numeric, v_total);
      END IF;
    END IF;
  END LOOP;
  v_monto_pagado := LEAST(v_monto_pagado, v_total);

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

-- ── 3) fn_pedido_cerrar — cierre manual (G4, cuando pedido_cierre_automatico=false) ────
CREATE OR REPLACE FUNCTION public.fn_pedido_cerrar(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido    RECORD;
  v_pendiente numeric;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.estado NOT IN ('entregado_parcial', 'listo_para_entrega') THEN
    RAISE EXCEPTION 'El pedido no está en un estado que se pueda cerrar';
  END IF;

  SELECT COALESCE(SUM(cantidad - cantidad_entregada), 0) INTO v_pendiente
  FROM pedido_items WHERE pedido_id = p_pedido_id AND estado <> 'cancelada';

  IF v_pendiente > 0 THEN
    RAISE EXCEPTION 'Todavía hay % unidades pendientes de entregar — no se puede cerrar', v_pendiente;
  END IF;

  UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;
END;
$$;

REVOKE ALL ON FUNCTION fn_pedido_cerrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_cerrar(uuid) TO authenticated, service_role;
