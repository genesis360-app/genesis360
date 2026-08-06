-- 338_tn_fulfillment_sync.sql
-- Fase C del roadmap de integraciones: avisar a TiendaNube cuando G360 despacha/entrega un
-- pedido. La API de fulfillment-orders de TN usa el ID INTERNO de la orden (numérico), distinto
-- de `ventas.tracking_id` (que guarda order.number, el "#101" visible al comerciante) — hace
-- falta guardarlo aparte para poder resolver la orden sin tener que buscarla por número.
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tn_order_id bigint;

-- Encola un job de sync cuando un envío de canal TiendaNube pasa a despachado/entregado.
-- Trigger sobre `envios` (no sobre `ventas`) porque el evento físico real (despachar/entregar)
-- se registra ahí — mismo criterio que ya se usa para stock (trg_tn_stock_sync, mig 062):
-- server-side vía trigger, no enganchado al código del frontend (se perdería si el usuario
-- cierra la pestaña antes de que el fetch termine).
CREATE OR REPLACE FUNCTION fn_enqueue_tn_fulfillment_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tn_order_id bigint;
BEGIN
  IF NEW.canal <> 'TiendaNube' OR NEW.estado NOT IN ('despachado', 'entregado') OR NEW.venta_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tn_order_id INTO v_tn_order_id FROM ventas WHERE id = NEW.venta_id;
  IF v_tn_order_id IS NULL THEN
    RETURN NEW; -- venta sin tn_order_id (creada antes de esta fase, o no viene de TN) — no hay nada que sincronizar
  END IF;

  INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
  SELECT
    NEW.tenant_id,
    NEW.sucursal_id,
    'TiendaNube',
    'sync_fulfillment',
    jsonb_build_object(
      'venta_id',       NEW.venta_id::text,
      'envio_id',       NEW.id::text,
      'tn_order_id',    v_tn_order_id,
      'estado_envio',   NEW.estado,
      'tracking_number', NEW.tracking_number
    ),
    NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM integration_job_queue q
    WHERE q.tenant_id = NEW.tenant_id
      AND q.integracion = 'TiendaNube'
      AND q.tipo = 'sync_fulfillment'
      AND q.status = 'pending'
      AND q.payload->>'envio_id' = NEW.id::text
      AND q.payload->>'estado_envio' = NEW.estado
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tn_fulfillment_sync ON envios;
CREATE TRIGGER trg_tn_fulfillment_sync
  AFTER UPDATE OF estado ON envios
  FOR EACH ROW
  WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION fn_enqueue_tn_fulfillment_sync();

-- Mecanismo principal de invocación del worker (más confiable que el GH Actions de backup,
-- .github/workflows/tn-fulfillment-sync.yml) — mismo patrón que meli-stock-sync.
-- ⚠ La URL es DE ESTE PROYECTO (DEV). meli-stock-sync (mig previa) confirma que este mismo
-- cron.schedule se aplica en PROD con la URL de PROD (jjffnbrdjchquexdfgwq) sustituida a mano —
-- no correr este archivo tal cual contra PROD, ajustar la URL antes de aplicarlo ahí.
SELECT cron.schedule(
  'tn-fulfillment-sync',
  '*/5 * * * *',
  $$ SELECT net.http_post(url := 'https://gcmhzdedrkmmzfzfveig.supabase.co/functions/v1/tn-fulfillment-worker', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb); $$
);
