-- Migration 161: G5 — precio en USD por producto + moneda de venta
-- Relevamiento Ventas G5: un producto puede tener precio en USD y configurar cómo se vende.
--   moneda_venta = 'local' (default): se usa precio_venta en moneda local (comportamiento actual).
--   moneda_venta = 'usd': el precio fuente es precio_usd; el POS lo convierte a moneda local
--                          a la cotización vigente al cargarlo al carrito.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS precio_usd   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS moneda_venta TEXT NOT NULL DEFAULT 'local';
