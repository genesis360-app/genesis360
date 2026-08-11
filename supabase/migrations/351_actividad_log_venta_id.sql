-- ============================================================
-- 351_actividad_log_venta_id.sql
-- Trazabilidad completa de una venta en /historial (pedido de GO 2026-08-10, tras trazar a mano la
-- venta #619: quería filtrar por número de venta y ver TODO lo que pasó — pedido, picking, envío,
-- devolución — sin cruzar 6 tablas a mano).
--
-- `actividad_log` ya registra acciones por entidad (venta/pedido/envio/...) pero sin ningún campo
-- que las conecte entre sí. Se agrega `venta_id` NULLABLE, poblado en el momento de cada INSERT
-- (write-time, nunca heurística de lectura — mismo criterio que el resto del ledger de trazabilidad,
-- ver mig 155) tanto para filas directas de venta (entidad_id = venta_id) como indirectas (pedido con
-- venta_origen_id, envío con venta_id): el frontend resuelve el valor antes de llamar logActividad().
-- ============================================================

ALTER TABLE public.actividad_log
  ADD COLUMN IF NOT EXISTS venta_id uuid REFERENCES public.ventas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_actividad_log_venta_id
  ON public.actividad_log(venta_id)
  WHERE venta_id IS NOT NULL;

COMMENT ON COLUMN public.actividad_log.venta_id IS
  'Venta a la que pertenece esta fila de actividad, directa o indirectamente (pedido/envío/devolución de esa venta). Poblado write-time por el frontend, no heurística de lectura. Mig 351.';
