-- ============================================================
-- 316_pedidos_venta_guards_entrega.sql
-- 🛑 REGLA #0 (PLATA + INVENTARIO) — los guards que hacen seguro el flujo Venta → Pedido que
-- abrió la mig 315, más la entrega en mostrador y el estado `listo_para_entrega`.
--
-- El problema que resuelve esta migración: un pedido con `venta_origen_id` YA TIENE su venta, su
-- plata asentada y su stock comprometido. Si entrara al ciclo normal de Pedidos pasarían DOS cosas
-- graves, las dos silenciosas:
--
--   1) DOBLE VENTA. `fn_pedido_generar_venta` (mig 295) crea una venta nueva en estado
--      'despachada', vuelve a rebajar stock y vuelve a asentar caja. Sobre un pedido que nació de
--      una venta, eso factura dos veces la misma mercadería y duplica el ingreso en caja.
--   2) DOBLE RESERVA / RESERVA FANTASMA. `fn_generar_tareas_picking_pedido` (mig 294) reserva en
--      `inventario_lineas.cantidad_reservada`. Pero si la venta era una RESERVA, esas unidades ya
--      están reservadas por ella → se reservaría el doble y el POS diría "sin stock" habiendo. Y si
--      la venta era DESPACHADA, el stock ya salió de `cantidad` → reservaría unidades de OTRAS
--      líneas, comprometiendo mercadería que no le corresponde a nadie.
--
-- Además se cierra un hueco preexistente: **`listo_para_entrega` era un estado MUERTO**. Estaba en
-- el CHECK de `pedidos.estado` (mig 292), la UI le tenía badge y tres RPCs lo leían como
-- precondición, pero NINGÚN código lo seteaba nunca — ningún pedido podía llegar a ese estado. Es
-- justo el estado que define la pestaña del mostrador ("picking listo, armado y listo para
-- entregar"), así que acá se lo hace real: completar la última tarea de picking del pedido lo
-- promueve solo.
-- ============================================================

-- ── 1) 🛑 Guard: un pedido nacido de una venta no puede generar otra venta ───────────────
-- Se implementa como trigger sobre `ventas` y no editando `fn_pedido_generar_venta` a propósito:
-- así cubre a CUALQUIER camino que intente crear la venta (la RPC, un script, una EF con
-- service_role), no solo al que conocemos hoy. Es la última línea antes de escribir la fila.
CREATE OR REPLACE FUNCTION public.trg_venta_no_duplica_pedido_venta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta_origen uuid;
  v_numero       integer;
BEGIN
  IF NEW.pedido_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.venta_origen_id, p.numero INTO v_venta_origen, v_numero
  FROM pedidos p WHERE p.id = NEW.pedido_id AND p.tenant_id = NEW.tenant_id;

  IF v_venta_origen IS NOT NULL THEN
    RAISE EXCEPTION 'El pedido #% nació de una venta que ya existe: no puede generar otra. Facturá o cobrá sobre la venta original — generar una segunda duplicaría el ingreso en caja y volvería a rebajar el stock.', v_numero;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_venta_no_duplica_pedido_venta() IS
  '🛑 REGLA #0 (mig 316): impide crear una segunda venta sobre un pedido que ya nació de una venta (pedidos.venta_origen_id). Sin esto, entregar uno de esos pedidos por el camino de PED4 duplicaría la facturación, el rebaje de stock y el asiento de caja.';

DROP TRIGGER IF EXISTS trg_ventas_no_duplica_pedido_venta ON ventas;
CREATE TRIGGER trg_ventas_no_duplica_pedido_venta
  BEFORE INSERT ON ventas
  FOR EACH ROW EXECUTE FUNCTION public.trg_venta_no_duplica_pedido_venta();

-- ── 2) Picking de un pedido que nació de una venta — SIN reservar ───────────────────────
-- Algoritmo distinto del de la mig 294, no el mismo con un flag:
--   · NO valida disponibilidad: el stock ya está comprometido por la venta. Validar contra
--     `cantidad - cantidad_reservada` daría "no hay stock" justamente porque la propia venta lo
--     reservó.
--   · NO toca `cantidad_reservada`: reservar de nuevo es el bug que esta migración existe para
--     evitar.
--   · Toma el LPN REAL que ya eligió la venta — `venta_item_despachos` es el registro definitivo
--     de de qué línea/ubicación salió cada unidad (ISS-075). Así el operario va a buscar
--     exactamente la mercadería que la venta comprometió, no "una equivalente".
--   · Si no hay despachos (venta reservada sin plan, o modo básico sin ubicaciones), cae a una
--     lectura FEFO de solo lectura para al menos indicar dónde buscar.
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
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — usá fn_generar_tareas_picking_pedido';
  END IF;

  -- Idempotencia: mismo criterio que la mig 294.
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
    RETURN;
  END IF;
  IF v_pedido.estado = 'cancelado' THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo'; END IF;

  FOR v_fuente IN
    -- Preferido: lo que la venta REALMENTE despachó/planificó, por LPN y ubicación.
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

  -- Fallback: la venta no dejó desglose por LPN (reserva sin plan / modo básico). Se indica el
  -- producto y la cantidad sin ubicación puntual — SOLO LECTURA, no se reserva nada.
  IF NOT FOUND THEN
    FOR v_fuente IN
      SELECT pi.producto_id, NULL::text AS lpn, NULL::uuid AS ubicacion_id,
             (pi.cantidad - pi.cantidad_entregada) AS cantidad
      FROM pedido_items pi
      WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
        AND (pi.cantidad - pi.cantidad_entregada) > 0
    LOOP
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                              origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_fuente.producto_id, v_fuente.cantidad,
              'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_fuente.producto_id, v_fuente.cantidad::integer)
                || ' — la venta no dejó desglose por LPN')
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END LOOP;
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid()
  WHERE id = p_pedido_id;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) IS
  'Picking de un pedido nacido de una venta (mig 316): toma el LPN que YA eligió la venta (venta_item_despachos) y NO toca cantidad_reservada — el stock ya lo comprometió la venta. Reservar de nuevo sería doble reserva.';

REVOKE ALL ON FUNCTION fn_generar_tareas_picking_pedido_venta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_pedido_venta(uuid) TO authenticated, service_role;

-- ── 3) Un solo punto de entrada: "Lanzar" despacha al algoritmo que corresponda ─────────
-- La UI (PedidosPage → "Lanzar") sigue llamando a `fn_generar_tareas_picking_pedido` sin saber de
-- qué tipo es el pedido.
--
-- 🛑 Se hace RENOMBRANDO la función original y poniendo un dispatcher chico encima, en vez de
-- re-escribir su cuerpo con un `CREATE OR REPLACE`. El cuerpo original son ~150 líneas que MUEVEN
-- STOCK (reservan `cantidad_reservada`, encadenan reabastecimientos): volver a tipearlas para
-- insertar cuatro líneas es exactamente la clase de cambio donde se cuela un error silencioso.
-- Renombrar deja el algoritmo probado intacto, byte por byte, y los GRANT lo siguen.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_generar_tareas_picking_pedido'
      AND pg_get_function_identity_arguments(p.oid) = 'p_pedido_id uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_generar_tareas_picking_pedido_stock'
  ) THEN
    ALTER FUNCTION public.fn_generar_tareas_picking_pedido(uuid)
      RENAME TO fn_generar_tareas_picking_pedido_stock;
  END IF;
END $$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_stock(uuid) IS
  'Picking de un pedido propio de logística (mig 294, renombrada en la 316): valida disponibilidad y RESERVA cantidad_reservada. NO usar para un pedido nacido de una venta — ese stock ya está comprometido. El dispatcher fn_generar_tareas_picking_pedido elige cuál corre.';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venta_origen uuid;
  v_existe       boolean;
BEGIN
  SELECT (p.id IS NOT NULL), p.venta_origen_id INTO v_existe, v_venta_origen
  FROM pedidos p WHERE p.id = p_pedido_id;
  IF NOT COALESCE(v_existe, false) THEN
    RAISE EXCEPTION 'Pedido inexistente o sin permisos';
  END IF;

  -- 🛑 REGLA #0: el pedido nacido de una venta ya tiene el stock comprometido por ella. Mandarlo
  -- al algoritmo de logística lo reservaría por SEGUNDA vez (o, si la venta ya rebajó, reservaría
  -- unidades de otras líneas que no le corresponden a nadie).
  IF v_venta_origen IS NOT NULL THEN
    RETURN QUERY SELECT * FROM fn_generar_tareas_picking_pedido_venta(p_pedido_id);
  ELSE
    RETURN QUERY SELECT * FROM fn_generar_tareas_picking_pedido_stock(p_pedido_id);
  END IF;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido(uuid) IS
  'Punto de entrada único de "Lanzar" (mig 316). Despacha a _venta (pedido nacido de una venta: NO re-reserva) o a _stock (pedido de logística, mig 294: valida y reserva).';

REVOKE ALL ON FUNCTION fn_generar_tareas_picking_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_pedido(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION fn_generar_tareas_picking_pedido_stock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_generar_tareas_picking_pedido_stock(uuid) TO authenticated, service_role;

-- ── 4) `listo_para_entrega` deja de ser un estado muerto ────────────────────────────────
-- Cuerpo idéntico al original salvo el bloque final: al completar la ÚLTIMA tarea de picking de un
-- pedido, el pedido se promueve solo. Es exactamente "picking listo y pedido armado" — la
-- condición que define la pestaña del mostrador.
CREATE OR REPLACE FUNCTION public.fn_completar_tarea_picking(p_tarea_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tarea RECORD;
  v_prec  RECORD;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Esta tarea no es de picking'; END IF;
  IF v_tarea.estado = 'completada' THEN RETURN; END IF;
  IF v_tarea.estado = 'cancelada' THEN RAISE EXCEPTION 'La tarea está cancelada'; END IF;

  IF v_tarea.tarea_precedente_id IS NOT NULL THEN
    SELECT * INTO v_prec FROM wms_tareas WHERE id = v_tarea.tarea_precedente_id;
    IF v_prec.estado IS DISTINCT FROM 'completada' THEN
      RAISE EXCEPTION 'Todavía falta completar el reabastecimiento previo de esta tarea';
    END IF;
  END IF;

  UPDATE wms_tareas SET estado = 'completada', completed_at = now() WHERE id = p_tarea_id;

  -- (mig 316) Si con ésta se terminó de pickear todo el pedido, pasa a "listo para entrega".
  IF v_tarea.pedido_id IS NOT NULL THEN
    UPDATE pedidos p
       SET estado = 'listo_para_entrega'
     WHERE p.id = v_tarea.pedido_id
       AND p.estado = 'en_preparacion'
       AND NOT EXISTS (
         SELECT 1 FROM wms_tareas w
         WHERE w.pedido_id = v_tarea.pedido_id
           AND w.tipo = 'picking'
           AND w.estado NOT IN ('completada', 'cancelada')
       );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_completar_tarea_picking(uuid) IS
  'Completa una tarea de picking. Desde la mig 316, al completarse la ÚLTIMA del pedido lo promueve a listo_para_entrega (hasta entonces ese estado no lo seteaba nadie y era inalcanzable).';

-- ── 5) Entrega en mostrador (retiro en local) ───────────────────────────────────────────
-- Lo que aprieta el de Ventas cuando el cliente pasa a buscar su pedido. NO toca plata ni stock:
-- la venta ya cobró y ya rebajó. Solo registra que la mercadería salió físicamente.
--
-- Decisión de GO: la entrega FÍSICA se confirma acá y facturar es un paso aparte (el modal de la
-- venta se abre después). Si el usuario cierra el modal sin emitir, el pedido igual quedó
-- entregado — la factura se emite luego desde el Historial. La alternativa (no entregar hasta
-- facturar) trabaría el mostrador cada vez que AFIP se cae.
--
-- Envíos como tabla única de trazabilidad de entregas (decisión de GO): se crea/actualiza un
-- `envios` de tipo 'retiro_local' en estado 'entregado'.
CREATE OR REPLACE FUNCTION public.fn_pedido_entregar_retiro(p_pedido_id uuid, p_receptor text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido  RECORD;
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

  UPDATE pedido_items SET cantidad_entregada = cantidad, estado = 'preparado'
  WHERE pedido_id = p_pedido_id AND estado <> 'cancelada';

  UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;

  -- Envíos = trazabilidad única de entregas. Si ya había un envío del pedido se actualiza; si no,
  -- se crea uno de tipo 'retiro_local' ya entregado (el cliente se lo llevó del mostrador).
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
  'Entrega en mostrador de un pedido nacido de una venta (mig 316). NO toca plata ni stock (la venta ya cobró y rebajó): marca el pedido entregado y deja el registro en Envíos como retiro_local/entregado. Devuelve el id de la venta para abrir su detalle y facturar.';

REVOKE ALL ON FUNCTION fn_pedido_entregar_retiro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_pedido_entregar_retiro(uuid, text) TO authenticated, service_role;
