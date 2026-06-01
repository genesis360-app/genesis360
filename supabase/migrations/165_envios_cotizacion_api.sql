-- Migration 165: ISS-174 F2 — metadata de cotización/generación por API de courier
--
-- Guarda la traza de la integración con la API del courier en cada envío:
--   cotizacion_json  → snapshot de la opción elegida + todas las opciones devueltas.
--   courier_orden_id → ID/numero de la orden creada en el courier (para tracking/etiqueta).
--   cotizado_api     → TRUE si el costo/servicio salió de una cotización por API (no manual).
-- tracking_number, tracking_url, etiqueta_url, costo_cotizado/real ya existen (mig 075/127).

ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS cotizacion_json  JSONB,
  ADD COLUMN IF NOT EXISTS courier_orden_id TEXT,
  ADD COLUMN IF NOT EXISTS cotizado_api     BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN envios.cotizacion_json  IS 'ISS-174: snapshot {elegida, opciones[]} de la cotización por API.';
COMMENT ON COLUMN envios.courier_orden_id IS 'ISS-174: ID/numero de la orden generada en el courier.';
COMMENT ON COLUMN envios.cotizado_api     IS 'ISS-174: TRUE si costo/servicio vienen de cotización por API.';
