-- Migration 128: pago de couriers en envíos

ALTER TABLE envios
  ADD COLUMN IF NOT EXISTS costo_pagado       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fecha_pago_courier  DATE,
  ADD COLUMN IF NOT EXISTS medio_pago_courier  TEXT;

CREATE INDEX IF NOT EXISTS idx_envios_pago ON envios(tenant_id, costo_pagado) WHERE costo_cotizado > 0;
