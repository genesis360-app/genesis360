-- Migration 125: Métodos de pago — comisión y config por método
ALTER TABLE metodos_pago
  ADD COLUMN IF NOT EXISTS comision_pct  NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS config        JSONB;

COMMENT ON COLUMN metodos_pago.comision_pct IS '% de comisión que cobra la plataforma (MP, tarjeta, etc.) — usado en cálculo de ganancia neta';
COMMENT ON COLUMN metodos_pago.config      IS 'Config extra por método: CBU/CVU para transferencia, etc.';
