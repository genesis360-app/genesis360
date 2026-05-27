-- Migration 143: cron automático de limpieza de tokens transportista
-- Limpia envios.token_transportista para envíos entregados/cancelados/devolución
-- con más de 30 días desde el último update. Los datos del envío se conservan;
-- solo se nulea el token para invalidar links públicos viejos.
-- Corre todos los días a las 4:00 AM AR (07:00 UTC).

SELECT cron.schedule(
  'cleanup_envio_tokens_transportista',
  '0 7 * * *',
  $$
    UPDATE envios
       SET token_transportista = NULL
     WHERE token_transportista IS NOT NULL
       AND estado IN ('entregado','cancelado','devolucion')
       AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '30 days';
  $$
);

COMMENT ON COLUMN envios.token_transportista IS 'UUID v4 para página pública /transporte/:token. Se limpia automáticamente 30 días después de que el envío llega a estado entregado/cancelado/devolucion (migration 143).';
