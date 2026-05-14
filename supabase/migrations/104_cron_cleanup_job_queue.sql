-- Migration 104: cron automático de limpieza de integration_job_queue
-- Elimina jobs completados (done) con más de 7 días de antigüedad
-- Corre todos los días a las 3:00 AM (hora Argentina = UTC-3 → 06:00 UTC)

SELECT cron.schedule(
  'cleanup_integration_job_queue',          -- nombre único del job
  '0 6 * * *',                             -- cron: 06:00 UTC = 03:00 AR
  $$
    DELETE FROM integration_job_queue
    WHERE status = 'done'
      AND created_at < NOW() - INTERVAL '7 days';
  $$
);
