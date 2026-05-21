-- Migration 127: Envíos — POD (Proof of Delivery) + estado en_bodega

-- 1. Ampliar el CHECK de estado para incluir en_bodega
ALTER TABLE envios DROP CONSTRAINT IF EXISTS envios_estado_check;
ALTER TABLE envios ADD CONSTRAINT envios_estado_check CHECK (estado IN (
  'pendiente', 'despachado', 'en_camino', 'en_bodega', 'entregado', 'devolucion', 'cancelado'
));

-- 2. Campos POD (Proof of Delivery)
ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS pod_url       TEXT,        -- URL foto/doc firmado
  ADD COLUMN IF NOT EXISTS pod_fecha     DATE,        -- fecha real de entrega
  ADD COLUMN IF NOT EXISTS pod_receptor  TEXT,        -- nombre de quien recibió
  ADD COLUMN IF NOT EXISTS pod_notas     TEXT;        -- observaciones de entrega
