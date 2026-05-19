-- Migration 122: extender constraint ventas_origen_check con canales de venta POS (ISS-110)
-- La constraint original solo permitía: POS, MELI, TiendaNube, Shopify, WooCommerce, MP
-- Se agregan los canales manuales: Instagram, Facebook, WhatsApp, Otros

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_origen_check;

ALTER TABLE ventas
  ADD CONSTRAINT ventas_origen_check
  CHECK (origen IN (
    'POS', 'MELI', 'TiendaNube', 'Shopify', 'WooCommerce', 'MP',
    'Instagram', 'Facebook', 'WhatsApp', 'Otros'
  ));
