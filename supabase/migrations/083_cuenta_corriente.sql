-- Migration 083: Cuenta corriente en clientes + flag en ventas
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS limite_credito DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INT DEFAULT 30;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS es_cuenta_corriente BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ventas_cc ON ventas (tenant_id, es_cuenta_corriente) WHERE es_cuenta_corriente = true;
CREATE INDEX IF NOT EXISTS idx_clientes_cc ON clientes (tenant_id) WHERE cuenta_corriente_habilitada = true;
