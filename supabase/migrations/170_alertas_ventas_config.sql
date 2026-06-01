-- Migration 170: VF4 (K2) — config de alertas automáticas de Ventas
--
-- Umbrales para las alertas event-driven (se disparan al cerrar la venta / procesar la
-- devolución y notifican a DUEÑO/SUPERVISOR/ADMIN vía `notificaciones`):
--   alerta_margen_negativo     → notifica cuando una venta despachada queda con margen < 0.
--   alerta_devoluciones_n / _dias → notifica si un cliente o producto supera N devoluciones
--                                   en los últimos M días.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS alerta_margen_negativo    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alerta_devoluciones_n     INT,            -- NULL = alerta desactivada
  ADD COLUMN IF NOT EXISTS alerta_devoluciones_dias  INT NOT NULL DEFAULT 30;

COMMENT ON COLUMN tenants.alerta_margen_negativo   IS 'VF4/K2: alertar cuando una venta despachada queda con margen negativo.';
COMMENT ON COLUMN tenants.alerta_devoluciones_n    IS 'VF4/K2: umbral N de devoluciones (cliente o producto) en M días para alertar. NULL = off.';
COMMENT ON COLUMN tenants.alerta_devoluciones_dias IS 'VF4/K2: ventana M (días) para el conteo de devoluciones.';
