-- ============================================================
-- 318_pedido_regla_por_tipo_entrega.sql
-- Reescribe la regla de la mig 315 según el diagrama de flujo de GO (2026-07-28).
--
-- REGLA NUEVA — **todas las ventas generan pedido, MENOS la entrega directa**:
--
--   entrega directa = canal PRESENCIAL + despachada + sin envío
--                     (el cliente se lleva la mercadería del mostrador en el momento)
--
--   generan pedido  = venta ONLINE (retiro en local o envío)
--                   · RESERVA o venta PENDIENTE (la mercadería no salió)
--                   · cualquier venta CON ENVÍO (propio o de tercero)
--
-- Sale de datos que YA existen (`canales_venta.clasificacion`, mig 168) — no hay nada que
-- configurar y es correcto por default para todos los tenants.
--
-- 🛑 DOS CAMBIOS DE FONDO respecto de la mig 315:
--
-- 1) **El gate de pago se mueve de la CREACIÓN a la ENTREGA.** La 315 solo creaba el pedido de una
--    reserva si estaba 100% pagada — con lo cual el depósito no tenía nada que preparar hasta que
--    entrara el saldo. En el flujo de GO la reserva y el retiro con pago parcial **generan el
--    pedido igual** y se preparan; el "validar pago total" es la barrera **antes de entregar**
--    (`fn_pedido_entregar_retiro`). Es el orden correcto: el depósito trabaja en paralelo y la
--    plata se controla en el mostrador, cuando el cliente viene a buscarlo.
--
-- 2) **`pedido_canales_auto` (lista de canales que SÍ generan) pasa a ser
--    `pedido_canales_excluidos` (lista de canales que NO generan).** La regla ahora es automática;
--    la config queda solo como excepción. Se RENOMBRA la columna en vez de crear otra: la 315
--    nunca llegó a PROD y en DEV el valor es `[]` en todos los tenants, así que no hay dato que
--    migrar y el significado invertido no puede quedar pegado a datos viejos.
--
-- 3) **El envío faltaba.** `fn_generar_tareas_picking_pedido_venta` (mig 316) no creaba el `envios`
--    — solo lo hacía la rama de logística. Con lo cual la rama "envío propio / envío tercero" del
--    diagrama quedaba sin registro en el módulo Envíos. Se cierra acá, en los dos sentidos:
--    el envío que aparece DESPUÉS de la venta (lo crea VentasPage) ahora también **crea el pedido**
--    si todavía no existía — que es el caso "mostrador + envío", imposible de detectar en el
--    INSERT de la venta porque el envío se inserta en una llamada HTTP posterior.
-- ============================================================

-- ── 1) La config invierte su sentido ────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='tenants' AND column_name='pedido_canales_auto')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='tenants' AND column_name='pedido_canales_excluidos') THEN
    ALTER TABLE tenants RENAME COLUMN pedido_canales_auto TO pedido_canales_excluidos;
    -- La 315 nunca salió de DEV y el default era '[]', así que no hay valores que invertir.
    UPDATE tenants SET pedido_canales_excluidos = '[]'::jsonb
     WHERE pedido_canales_excluidos IS DISTINCT FROM '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pedido_canales_excluidos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tenants.pedido_canales_excluidos IS
  'EXCEPCIÓN a la regla automática (mig 318): canales de venta (array de canales_venta.id) cuyas ventas NO generan Pedido de preparación aunque les correspondería. [] = ninguna excepción, la regla manda sola.';

-- ── 2) ¿Esta venta necesita preparación? — la regla, en un solo lugar ────────────────────
-- `p_con_envio` se pasa aparte porque en el AFTER INSERT de `ventas` el envío todavía NO existe
-- (VentasPage lo inserta en una llamada HTTP posterior): el trigger de `envios` la vuelve a llamar
-- con `true` cuando aparece.
CREATE OR REPLACE FUNCTION public.fn_venta_requiere_pedido(p_venta_id uuid, p_con_envio boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta     RECORD;
  v_canal_id  uuid;
  v_clasif    text;
  v_excluidos jsonb;
BEGIN
  SELECT * INTO v_venta FROM ventas WHERE id = p_venta_id;
  IF v_venta IS NULL THEN RETURN false; END IF;

  -- Una venta nacida de un pedido nunca genera otro (anti-loop), y una anulada/devuelta no tiene
  -- nada que preparar.
  IF v_venta.pedido_id IS NOT NULL THEN RETURN false; END IF;
  IF v_venta.estado NOT IN ('pendiente', 'reservada', 'despachada') THEN RETURN false; END IF;

  v_canal_id := fn_canal_de_origen(v_venta.tenant_id, v_venta.origen);
  SELECT COALESCE(pedido_canales_excluidos, '[]'::jsonb) INTO v_excluidos
  FROM tenants WHERE id = v_venta.tenant_id;
  IF v_canal_id IS NOT NULL AND v_excluidos ? v_canal_id::text THEN
    RETURN false;   -- excepción explícita del tenant
  END IF;

  -- Con envío (propio o de tercero) SIEMPRE hay que preparar y despachar.
  IF p_con_envio OR EXISTS (SELECT 1 FROM envios WHERE venta_id = p_venta_id) THEN
    RETURN true;
  END IF;

  -- Reserva o pendiente: la mercadería no salió del local, hay que prepararla para cuando venga.
  IF v_venta.estado IN ('reservada', 'pendiente') THEN RETURN true; END IF;

  -- Sin envío y ya despachada: depende del canal.
  --   · online     → el cliente NO está presente: es un retiro en local, hay que prepararlo.
  --   · presencial → ENTREGA DIRECTA, el cliente se lo llevó del mostrador. No hay nada que preparar.
  -- Sin canal resuelto se asume presencial (el caso conservador: no inventa trabajo de depósito).
  SELECT clasificacion INTO v_clasif FROM canales_venta WHERE id = v_canal_id;
  RETURN COALESCE(v_clasif, 'presencial') = 'online';
END;
$$;

COMMENT ON FUNCTION public.fn_venta_requiere_pedido(uuid, boolean) IS
  'Regla única (mig 318): toda venta genera Pedido de preparación MENOS la entrega directa (canal presencial + despachada + sin envío). Deriva de canales_venta.clasificacion; tenants.pedido_canales_excluidos es la excepción.';

-- ── 3) Crear el pedido — reusable desde los dos triggers ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_crear_desde_venta(p_venta_id uuid, p_con_envio boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta    RECORD;
  v_tipo_id  uuid;
  v_pedido_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM pedidos WHERE venta_origen_id = p_venta_id) THEN RETURN NULL; END IF;
  IF NOT fn_venta_requiere_pedido(p_venta_id, p_con_envio) THEN RETURN NULL; END IF;

  SELECT * INTO v_venta FROM ventas WHERE id = p_venta_id;

  -- Tipo de pedido: se prefiere el que matchea el destino ("Retiro en local" / "E-commerce"), y si
  -- el tenant los borró/renombró se cae al primer tipo activo (tipo_pedido_id es NOT NULL).
  SELECT id INTO v_tipo_id FROM tipos_pedido
  WHERE tenant_id = v_venta.tenant_id AND activo = true
    AND lower(nombre) = CASE WHEN p_con_envio THEN 'e-commerce' ELSE 'retiro en local' END
  LIMIT 1;
  IF v_tipo_id IS NULL THEN
    SELECT id INTO v_tipo_id FROM tipos_pedido
    WHERE tenant_id = v_venta.tenant_id AND activo = true
    ORDER BY orden NULLS LAST, nombre LIMIT 1;
  END IF;
  IF v_tipo_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO pedidos (
    tenant_id, sucursal_id, tipo_pedido_id, cliente_id, cliente_nombre, cliente_telefono,
    estado, requiere_envio, creado_por, confirmado_at, venta_origen_id, notas
  ) VALUES (
    v_venta.tenant_id, v_venta.sucursal_id, v_tipo_id, v_venta.cliente_id,
    CASE WHEN v_venta.cliente_id IS NULL THEN v_venta.cliente_nombre END,
    CASE WHEN v_venta.cliente_id IS NULL THEN v_venta.cliente_telefono END,
    'confirmado', p_con_envio, v_venta.usuario_id, now(), p_venta_id,
    'Generado automáticamente desde la venta #' || COALESCE(v_venta.numero::text, '?')
  )
  ON CONFLICT (venta_origen_id) WHERE venta_origen_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_pedido_id;

  IF v_pedido_id IS NOT NULL THEN
    PERFORM fn_pedido_sync_items_desde_venta(v_pedido_id);
  END IF;
  RETURN v_pedido_id;
END;
$$;

COMMENT ON FUNCTION public.fn_pedido_crear_desde_venta(uuid, boolean) IS
  'Crea el Pedido de preparación de una venta (mig 318). Idempotente. Lo llaman el trigger de ventas y el de envíos — este último cubre el caso "mostrador + envío", que en el INSERT de la venta todavía no se puede detectar.';

-- ── 4) Trigger de ventas — ya sin el gate de pago ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_venta_auto_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_pedido_crear_desde_venta(NEW.id, false);
  RETURN NULL;
-- 🛑 REGLA #0 — una VENTA nunca se cae por culpa de un documento de LOGÍSTICA. La plata y el stock
-- de la venta ya están decididos cuando esto corre; un pedido que no se pudo crear se regenera,
-- una venta perdida en el mostrador no.
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_venta_auto_pedido] no se pudo crear el pedido de la venta % (tenant %): %',
    NEW.id, NEW.tenant_id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_venta_auto_pedido() IS
  'Crea el Pedido de preparación de una venta que lo necesita (mig 318: todas menos la entrega directa). El gate de pago ya NO está acá — se validá al entregar.';

-- El UPDATE OF sigue escuchando estado/monto_pagado: una venta pendiente que pasa a reservada, o
-- una despachada que se anula y se rehace, tienen que re-evaluar la regla.
DROP TRIGGER IF EXISTS trg_ventas_auto_pedido ON ventas;
CREATE TRIGGER trg_ventas_auto_pedido
  AFTER INSERT OR UPDATE OF estado, monto_pagado ON ventas
  FOR EACH ROW EXECUTE FUNCTION public.trg_venta_auto_pedido();

-- ── 5) El envío también CREA el pedido si todavía no existe ─────────────────────────────
-- Caso "mostrador + envío propio/tercero" del diagrama: en el INSERT de la venta no se puede saber
-- que va a haber envío (VentasPage lo inserta después), así que la venta se ve como entrega directa
-- y no genera pedido. Cuando aparece el envío, acá se crea.
CREATE OR REPLACE FUNCTION public.trg_envio_marca_pedido_con_envio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pedido_id uuid;
BEGIN
  IF NEW.venta_id IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.tipo, 'venta') = 'retiro_local' THEN RETURN NULL; END IF;

  SELECT id INTO v_pedido_id FROM pedidos WHERE venta_origen_id = NEW.venta_id;

  IF v_pedido_id IS NULL THEN
    v_pedido_id := fn_pedido_crear_desde_venta(NEW.venta_id, true);
  ELSE
    UPDATE pedidos SET requiere_envio = true
     WHERE id = v_pedido_id AND requiere_envio = false
       AND estado NOT IN ('entregado', 'entregado_parcial', 'cancelado');
  END IF;

  IF v_pedido_id IS NOT NULL THEN
    UPDATE envios SET pedido_id = v_pedido_id WHERE id = NEW.id AND pedido_id IS NULL;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_envio_marca_pedido_con_envio] envío % : %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_envio_marca_pedido_con_envio() IS
  'Al aparecer un envío de una venta (mig 318): crea el pedido si no existía (caso mostrador+envío, indetectable en el INSERT de la venta) o lo marca requiere_envio, y vincula envios.pedido_id.';

-- ── 6) El picking de un venta-pedido con envío también crea el envío ────────────────────
-- La mig 316 dejó esta rama sin el `envios` que sí crea la de logística (F2). Sin esto, la rama
-- "envío propio / envío tercero" del diagrama no quedaba registrada en el módulo Envíos.
CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido_venta(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido    RECORD;
  v_fuente    RECORD;
  v_pick_id   uuid;
  v_ubic_tipo text;
  v_domicilio_id uuid;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — usá fn_generar_tareas_picking_pedido';
  END IF;

  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
    RETURN;
  END IF;
  IF v_pedido.estado = 'cancelado' THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo'; END IF;

  -- 🛑 NO se toca `cantidad_reservada`: la venta ya comprometió este stock (ver mig 316).
  FOR v_fuente IN
    SELECT vid.producto_id, vid.lpn, vid.ubicacion_id, SUM(vid.cantidad) AS cantidad
    FROM venta_item_despachos vid
    WHERE vid.venta_id = v_pedido.venta_origen_id AND vid.cantidad > 0
    GROUP BY vid.producto_id, vid.lpn, vid.ubicacion_id
  LOOP
    SELECT u.tipo_ubicacion INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                            ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_fuente.producto_id, v_fuente.cantidad,
            v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
            fn_wms_describir_cantidad(v_fuente.producto_id, v_fuente.cantidad::integer)
              || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' — fuera de zona de picking' ELSE '' END)
    RETURNING id INTO v_pick_id;
    RETURN QUERY SELECT v_pick_id, 'picking'::text;
  END LOOP;

  IF NOT FOUND THEN
    FOR v_fuente IN
      SELECT pi.producto_id, NULL::text AS lpn, NULL::uuid AS ubicacion_id,
             (pi.cantidad - pi.cantidad_entregada) AS cantidad
      FROM pedido_items pi
      WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
        AND (pi.cantidad - pi.cantidad_entregada) > 0
    LOOP
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_fuente.producto_id, v_fuente.cantidad,
              'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_fuente.producto_id, v_fuente.cantidad::integer)
                || ' — la venta no dejó desglose por LPN')
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END LOOP;
  END IF;

  -- (mig 318) Envío: mismo criterio que la rama de logística (F2). Se salta si la venta ya tiene
  -- uno — VentasPage lo crea al registrar la venta, y el trigger de `envios` ya lo vinculó.
  IF v_pedido.requiere_envio
     AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = p_pedido_id)
     AND NOT EXISTS (SELECT 1 FROM envios WHERE venta_id = v_pedido.venta_origen_id) THEN
    v_domicilio_id := NULL;
    IF v_pedido.cliente_id IS NOT NULL THEN
      SELECT cd.id INTO v_domicilio_id FROM cliente_domicilios cd
      WHERE cd.cliente_id = v_pedido.cliente_id
      ORDER BY cd.es_principal DESC, cd.created_at LIMIT 1;
    END IF;
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, venta_id, destino_id, canal, estado, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_pedido.venta_origen_id,
            v_domicilio_id, 'Pedidos', 'pendiente',
            'Generado automáticamente al lanzar el Pedido #' || v_pedido.numero);
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid()
  WHERE id = p_pedido_id;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) IS
  'Picking de un pedido nacido de una venta (migs 316/318): usa el LPN que ya eligió la venta, NO re-reserva stock, y crea el envío si el pedido lo requiere y todavía no hay uno.';

-- ── 7) 💵 El gate de pago, ahora en la ENTREGA ──────────────────────────────────────────
-- Es la caja "Debe validar pago total" del diagrama. La reserva y el retiro con pago parcial se
-- preparan igual; lo que no puede pasar es que la mercadería SALGA sin estar cobrada.
CREATE OR REPLACE FUNCTION public.fn_pedido_entregar_retiro(p_pedido_id uuid, p_receptor text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido   RECORD;
  v_venta    RECORD;
  v_saldo    numeric;
  v_envio_id uuid;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — entregalo desde el módulo Pedidos, que además genera la venta';
  END IF;
  IF v_pedido.estado = 'entregado' THEN RETURN v_pedido.venta_origen_id; END IF;  -- idempotente
  IF v_pedido.estado <> 'listo_para_entrega' THEN
    RAISE EXCEPTION 'El pedido todavía no está listo para entregar (estado actual: %)', v_pedido.estado;
  END IF;

  -- 💵 Gate de pago. `total` NO incluye el costo de envío pero `monto_pagado` SÍ (ISS-105), así que
  -- el saldo se calcula sumándolo. Se tolera medio peso de redondeo, igual criterio que el resto
  -- de los chequeos de CC del sistema.
  SELECT * INTO v_venta FROM ventas WHERE id = v_pedido.venta_origen_id FOR UPDATE;
  IF v_venta IS NULL THEN RAISE EXCEPTION 'No se encuentra la venta del pedido'; END IF;
  v_saldo := COALESCE(v_venta.total, 0) + COALESCE(v_venta.costo_envio, 0) - COALESCE(v_venta.monto_pagado, 0);
  IF v_saldo > 0.5 AND NOT COALESCE(v_venta.es_cuenta_corriente, false) THEN
    RAISE EXCEPTION 'El pedido no está pagado: falta cobrar $%. Cobrá el saldo en el detalle de la venta y volvé a entregarlo.',
      ROUND(v_saldo, 2);
  END IF;

  UPDATE pedido_items SET cantidad_entregada = cantidad, estado = 'preparado'
  WHERE pedido_id = p_pedido_id AND estado <> 'cancelada';

  UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;

  SELECT id INTO v_envio_id FROM envios WHERE pedido_id = p_pedido_id LIMIT 1;
  IF v_envio_id IS NULL THEN
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, venta_id, tipo, canal, estado,
                        pod_receptor, pod_fecha, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_pedido.venta_origen_id,
            'retiro_local', 'Retiro en local', 'entregado',
            NULLIF(btrim(COALESCE(p_receptor, '')), ''), CURRENT_DATE,
            'Retirado en el local — Pedido #' || v_pedido.numero)
    RETURNING id INTO v_envio_id;
  ELSE
    UPDATE envios
       SET estado = 'entregado',
           venta_id = COALESCE(venta_id, v_pedido.venta_origen_id),
           pod_receptor = COALESCE(pod_receptor, NULLIF(btrim(COALESCE(p_receptor, '')), '')),
           pod_fecha = COALESCE(pod_fecha, CURRENT_DATE)
     WHERE id = v_envio_id;
  END IF;

  RETURN v_pedido.venta_origen_id;
END;
$$;

COMMENT ON FUNCTION public.fn_pedido_entregar_retiro(uuid, text) IS
  'Entrega en mostrador (migs 316/318). 💵 Valida que la venta esté SALDADA antes de dejar salir la mercadería (salvo cuenta corriente, que es deuda aceptada a propósito). No toca plata ni stock: la venta ya cobró y rebajó.';

REVOKE ALL ON FUNCTION fn_pedido_entregar_retiro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_entregar_retiro(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION fn_venta_requiere_pedido(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_venta_requiere_pedido(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION fn_pedido_crear_desde_venta(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_crear_desde_venta(uuid, boolean) TO authenticated, service_role;
