-- 424 — Aviso al dueño cuando Mercado Libre o Tienda Nube no toman un precio nuevo
--
-- D2 del relevamiento de precio programado (respondido por GO el 2026-09-14): "reintento + aviso al dueño".
-- El reintento ya existía: `meli-stock-worker` y `tn-stock-worker` reintentan `sync_precio` con espera creciente
-- (1, 2, 4 y 8 minutos, `max_retries` 5) y después dejan el job en `failed` sin avisar a nadie. Resultado: el
-- local cobra el precio nuevo y la publicación sigue con el viejo, y alguien puede comprar online al precio
-- anterior.
--
-- Este trigger avisa cuando un `sync_precio` pasa a `failed` (reintentos agotados o un error que no se
-- reintenta, como "Sin credenciales ML"). Vale para cualquier cambio de precio, programado o manual: el riesgo es
-- el mismo. Se hace en la base y no en las Edge Functions para no depender de redesplegarlas.
--
-- Una caída de la API puede hacer fallar muchos productos juntos: si el usuario ya tiene un aviso SIN LEER del
-- mismo canal de las últimas 6 horas, se suma a ese ("N productos…") en vez de llenar la campanita.

CREATE OR REPLACE FUNCTION public.fn_notificar_sync_precio_fallido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_canal       text := CASE NEW.integracion
                          WHEN 'MercadoLibre' THEN 'Mercado Libre'
                          WHEN 'TiendaNube'   THEN 'Tienda Nube'
                          ELSE NEW.integracion
                        END;
  v_producto_id uuid;
  v_producto    text;
  v_error       text := left(coalesce(NEW.error_last, 'sin detalle'), 200);
  u             RECORD;
  v_notif       RECORD;
BEGIN
  BEGIN
    v_producto_id := NULLIF(NEW.payload->>'producto_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_producto_id := NULL;
  END;
  SELECT nombre INTO v_producto FROM public.productos WHERE id = v_producto_id AND tenant_id = NEW.tenant_id;
  v_producto := coalesce(v_producto, 'Un producto');

  FOR u IN
    SELECT id FROM public.users WHERE tenant_id = NEW.tenant_id AND rol IN ('DUEÑO', 'SUPER_USUARIO')
  LOOP
    SELECT n.id, coalesce((n.metadata->>'cantidad')::int, 1) AS cantidad
      INTO v_notif
      FROM public.notificaciones n
     WHERE n.user_id = u.id
       AND n.leida = false
       AND n.metadata->>'origen' = 'sync_precio_fallido'
       AND n.metadata->>'integracion' = NEW.integracion
       AND n.created_at > now() - interval '6 hours'
     ORDER BY n.created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.notificaciones
         SET mensaje = (v_notif.cantidad + 1) || ' productos siguen con el precio anterior en ' || v_canal
                       || ' (el último: ' || v_producto || '). Revisá la conexión y actualizá esas publicaciones.',
             metadata = metadata || jsonb_build_object('cantidad', v_notif.cantidad + 1,
                                                       'ultimo_job_id', NEW.id,
                                                       'ultimo_producto_id', v_producto_id,
                                                       'ultimo_error', v_error),
             created_at = now()
       WHERE id = v_notif.id;
    ELSE
      INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url, metadata)
      VALUES (NEW.tenant_id, u.id, 'danger',
              'No se pudo actualizar un precio en ' || v_canal,
              v_producto || ' sigue con el precio anterior en ' || v_canal || '. Último error: ' || v_error
                || '. Revisá la conexión o actualizá la publicación a mano.',
              '/configuracion?tab=conectividad',
              jsonb_build_object('origen', 'sync_precio_fallido', 'integracion', NEW.integracion, 'cantidad', 1,
                                 'ultimo_job_id', NEW.id, 'ultimo_producto_id', v_producto_id,
                                 'ultimo_error', v_error));
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El worker tiene que poder marcar el job igual: un aviso que no sale no frena la cola.
  RAISE WARNING '[fn_notificar_sync_precio_fallido] job %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_sync_precio_fallido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notificar_sync_precio_fallido ON public.integration_job_queue;
CREATE TRIGGER trg_notificar_sync_precio_fallido
  AFTER UPDATE OF status ON public.integration_job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' AND NEW.tipo = 'sync_precio')
  EXECUTE FUNCTION public.fn_notificar_sync_precio_fallido();

COMMENT ON FUNCTION public.fn_notificar_sync_precio_fallido() IS
  'D2 (precio programado): avisa a DUEÑO/SUPER_USUARIO cuando un sync_precio de ML/TN queda failed; agrupa los avisos sin leer del mismo canal de las últimas 6 horas. Mig 424.';
