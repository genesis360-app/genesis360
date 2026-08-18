-- ============================================================
-- 360_pedido_envio_entregado_sync.sql
-- 🛑 REGLA #0 (INVENTARIO / TRAZABILIDAD) — cierra un gap real encontrado por GO: un pedido con
-- envío real (courier/reparto propio, `requiere_envio=true`) nunca pasaba a `entregado`.
--
-- Por qué pasaba: el camino "retiro en mostrador" está bien sincronizado — `fn_pedido_entregar_retiro`
-- (mig 316) actualiza `pedidos.estado='entregado'` Y `envios.estado='entregado'` en la misma
-- transacción. Pero el camino "envío real" NO pasa por esa función: `EnviosPage.tsx` (guardar POD)
-- hace un `UPDATE envios SET estado='entregado', ...` directo, sin tocar `pedidos` para nada. El
-- pedido quedaba pegado en `listo_para_entrega` para siempre, aunque la mercadería ya se hubiera
-- entregado — visible como contradicción real en la ficha de venta (badge "Envío · Entregado" junto
-- a badge "Pedido · Listo para entrega").
--
-- Fix: un trigger sobre `envios`, no un cambio en `EnviosPage.tsx` — mismo criterio ya usado en este
-- módulo (mig 315, guard de doble-venta): un trigger cubre CUALQUIER camino que marque un envío como
-- entregado (UI, webhook TN/MELI a futuro, script), no solo el que conocemos hoy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_envio_entregado_sincroniza_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.trg_envio_entregado_sincroniza_pedido() IS
  'Al marcar un envío como entregado (POD), sincroniza pedidos.estado=entregado + pedido_items si el envío está vinculado a un pedido (mig 360). Cierra el gap del camino "envío real" — el camino "retiro en mostrador" ya lo hacía bien via fn_pedido_entregar_retiro (mig 316).';

DROP TRIGGER IF EXISTS trg_envios_entregado_sync_pedido ON public.envios;
CREATE TRIGGER trg_envios_entregado_sync_pedido
  AFTER INSERT OR UPDATE OF estado ON public.envios
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_envio_entregado_sincroniza_pedido();
