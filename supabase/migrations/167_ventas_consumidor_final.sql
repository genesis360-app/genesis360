-- Migration 167: VF1 (H5) — flag Consumidor Final por venta
--
-- Al iniciar la venta el POS marca si es a Consumidor Final o a Cliente registrado.
-- Si el negocio factura y NO es consumidor final, el cliente es obligatorio (para
-- poder facturar a un cliente identificado). Se persiste para la facturación/reportes.

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS consumidor_final BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ventas.consumidor_final IS 'VF1/H5: TRUE = venta a Consumidor Final (sin cliente identificado). FALSE = cliente registrado.';
