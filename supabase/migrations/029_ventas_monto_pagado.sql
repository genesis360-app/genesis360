-- Migration 029: monto_pagado en ventas
--
-- Permite registrar pagos parciales en reservas.
-- Al crear una reserva se guarda el monto cobrado en ese momento.
-- Al despachar se cobra el saldo restante (total - monto_pagado).
-- Si monto_pagado >= total al despachar, no se solicita pago adicional.

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN ventas.monto_pagado IS 'Monto ya cobrado (en reservas con pago parcial). Al despachar se cobra total - monto_pagado.';
