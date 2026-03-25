-- M16: Combos — agregar descuento_tipo y descuento_monto
-- Permite descuento en % (pct), monto fijo ARS (monto_ars) o monto fijo USD (monto_usd)
ALTER TABLE combos ADD COLUMN IF NOT EXISTS descuento_tipo TEXT NOT NULL DEFAULT 'pct';
ALTER TABLE combos ADD COLUMN IF NOT EXISTS descuento_monto DECIMAL(12,2) NOT NULL DEFAULT 0;
