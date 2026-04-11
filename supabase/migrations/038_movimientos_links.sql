-- Migration 038: Add venta_id and gasto_id FK columns to movimientos_stock
-- Allows tracing each stock movement back to the originating sale or expense

ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_stock_venta_id ON movimientos_stock(venta_id) WHERE venta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_gasto_id ON movimientos_stock(gasto_id) WHERE gasto_id IS NOT NULL;
