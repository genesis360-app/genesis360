-- 465 — El pedido hereda la fecha de entrega acordada del envío (pedido de GO 2026-10-02)
--
-- En el POS, una venta con envío guarda la fecha de entrega acordada (y el rango horario) en `envios`. El trigger
-- `trg_envio_marca_pedido_con_envio` crea o vincula el pedido de preparación, pero no le pasaba la fecha: el pedido
-- quedaba con `fecha_entrega_solicitada` vacía y el equipo de preparación no sabía qué priorizar (ni funcionaba la
-- alerta de "pedido atrasado", que mira esa columna).
--   · Al crear el envío: el pedido toma la fecha si no tenía una.
--   · Si después se cambia la fecha del envío: el pedido abierto la sigue.
--   · Backfill: pedidos ABIERTOS sin fecha cuyo envío vinculado sí la tiene.
-- La priorización real de tareas (cola WMS, asignación automática por permisos/vehículo) queda anotada aparte.

CREATE OR REPLACE FUNCTION public.trg_envio_marca_pedido_con_envio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Mig 465: la fecha de entrega acordada en la venta llega al pedido (si el pedido no tenía una propia).
    IF NEW.fecha_entrega_acordada IS NOT NULL THEN
      UPDATE pedidos SET fecha_entrega_solicitada = NEW.fecha_entrega_acordada
       WHERE id = v_pedido_id AND fecha_entrega_solicitada IS NULL;
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_envio_marca_pedido_con_envio] envío % : %', NEW.id, SQLERRM;
  RETURN NULL;
END; $function$;

-- Si se reprograma la entrega desde Envíos, el pedido abierto la sigue.
CREATE OR REPLACE FUNCTION public.trg_envio_fecha_sincroniza_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pedido_id IS NULL OR NEW.fecha_entrega_acordada IS NOT DISTINCT FROM OLD.fecha_entrega_acordada THEN
    RETURN NULL;
  END IF;
  UPDATE pedidos SET fecha_entrega_solicitada = NEW.fecha_entrega_acordada
   WHERE id = NEW.pedido_id AND tenant_id = NEW.tenant_id
     AND estado NOT IN ('entregado', 'entregado_parcial', 'cancelado');
  RETURN NULL;
END; $function$;

DROP TRIGGER IF EXISTS trg_envios_fecha_sync_pedido ON public.envios;
CREATE TRIGGER trg_envios_fecha_sync_pedido
  AFTER UPDATE OF fecha_entrega_acordada ON public.envios
  FOR EACH ROW EXECUTE FUNCTION public.trg_envio_fecha_sincroniza_pedido();

-- Backfill: pedidos abiertos sin fecha cuyo envío vinculado la tiene (el más reciente si hubiera más de uno).
UPDATE pedidos p
   SET fecha_entrega_solicitada = e.fecha_entrega_acordada
  FROM (SELECT DISTINCT ON (pedido_id) pedido_id, tenant_id, fecha_entrega_acordada
          FROM envios
         WHERE pedido_id IS NOT NULL AND fecha_entrega_acordada IS NOT NULL
         ORDER BY pedido_id, created_at DESC) e
 WHERE p.id = e.pedido_id AND p.tenant_id = e.tenant_id
   AND p.fecha_entrega_solicitada IS NULL
   AND p.estado NOT IN ('entregado', 'entregado_parcial', 'cancelado');
