-- 495 — No sale mercadería de una venta que sigue RESERVADA (REGLA #0, inventario) — reporte de GO 2026-10-09
--
-- Caso (DEV, Almacén Jorgito, pedidos #20 y #68): Ventas → Retiro → "Entregado" marcaba el pedido entregado y abría el
-- detalle de la venta para que el cajero la finalizara; si se cerraba sin "Finalizar", la mercadería ya se había ido pero la
-- venta quedaba RESERVADA para siempre: el stock nunca se rebajaba y la reserva quedaba trabada. Envíos tenía el mismo hueco
-- (un envío se podía despachar / entregar con la venta reservada).
--
--   1. fn_pedido_entregar_retiro: rechaza si la venta sigue 'reservada' (la pantalla ahora la finaliza antes, en el mismo
--      click). Resto igual a la versión vigente.
--   2. Trigger en envios: no pasa a despachado / en camino / entregado si su venta sigue 'reservada'.

CREATE OR REPLACE FUNCTION public.fn_pedido_entregar_retiro(p_pedido_id uuid, p_receptor text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_pedido RECORD; v_venta RECORD; v_saldo numeric; v_envio_id uuid;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — entregalo desde el módulo Pedidos, que además genera la venta';
  END IF;
  IF v_pedido.estado = 'entregado' THEN RETURN v_pedido.venta_origen_id; END IF;
  IF v_pedido.estado <> 'listo_para_entrega' THEN
    RAISE EXCEPTION 'El pedido todavía no está listo para entregar (estado actual: %)', v_pedido.estado;
  END IF;

  -- 💵 Gate de pago (mig 318). total NO incluye costo_envio pero monto_pagado SÍ (ISS-105).
  SELECT * INTO v_venta FROM ventas WHERE id = v_pedido.venta_origen_id FOR UPDATE;
  IF v_venta IS NULL THEN RAISE EXCEPTION 'No se encuentra la venta del pedido'; END IF;
  v_saldo := COALESCE(v_venta.total, 0) + COALESCE(v_venta.costo_envio, 0) - COALESCE(v_venta.monto_pagado, 0);
  IF v_saldo > 0.5 AND NOT COALESCE(v_venta.es_cuenta_corriente, false) THEN
    RAISE EXCEPTION 'El pedido no está pagado: falta cobrar $%. Cobrá el saldo en el detalle de la venta y volvé a entregarlo.',
      ROUND(v_saldo, 2);
  END IF;
  -- Mig 495: la mercadería no sale con la venta reservada (el stock se rebaja al finalizarla).
  IF v_venta.estado = 'reservada' THEN
    RAISE EXCEPTION 'La venta #% sigue reservada: finalizala (rebaja el stock) antes de entregar el pedido.', v_venta.numero;
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
    UPDATE envios SET estado = 'entregado',
           venta_id = COALESCE(venta_id, v_pedido.venta_origen_id),
           pod_receptor = COALESCE(pod_receptor, NULLIF(btrim(COALESCE(p_receptor, '')), '')),
           pod_fecha = COALESCE(pod_fecha, CURRENT_DATE)
     WHERE id = v_envio_id;
  END IF;
  RETURN v_pedido.venta_origen_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_envio_exige_venta_finalizada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_venta RECORD;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado OR NEW.estado NOT IN ('despachado', 'en_camino', 'entregado')
     OR NEW.venta_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT numero, estado INTO v_venta FROM ventas WHERE id = NEW.venta_id;
  IF v_venta.estado = 'reservada' THEN
    RAISE EXCEPTION 'La venta #% sigue reservada: finalizala (rebaja el stock) antes de despachar o entregar el envío.', v_venta.numero
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_envio_exige_venta_finalizada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_envio_exige_venta_finalizada ON public.envios;
CREATE TRIGGER trg_envio_exige_venta_finalizada
  BEFORE UPDATE OF estado ON public.envios
  FOR EACH ROW EXECUTE FUNCTION public.fn_envio_exige_venta_finalizada();
