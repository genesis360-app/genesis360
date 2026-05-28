-- Migration 150: ISS-190 — Pago parcial de gasto: monto_pagado + estado_pago

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS monto_pagado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado_pago   TEXT NOT NULL DEFAULT 'pagado'
    CHECK (estado_pago IN ('pendiente','parcial','pagado'));

-- Backfill: gastos existentes con medio_pago definido → asumimos pagados
-- (el flujo anterior siempre registraba el pago al crear)
UPDATE gastos
SET monto_pagado = monto, estado_pago = 'pagado'
WHERE medio_pago IS NOT NULL AND medio_pago != '[]' AND medio_pago != '';

-- Gastos sin medio_pago: quedan en estado pendiente con monto_pagado = 0
UPDATE gastos
SET monto_pagado = 0, estado_pago = 'pendiente'
WHERE medio_pago IS NULL OR medio_pago = '[]' OR medio_pago = '';

CREATE INDEX IF NOT EXISTS idx_gastos_estado_pago ON gastos(tenant_id, estado_pago);
