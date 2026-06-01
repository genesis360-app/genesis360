-- Migration 164: ISS-174 F1 — peso y dimensiones en el dato maestro del producto
--
-- Usado cuando tenants.envio_peso_fuente = 'producto': el peso/volumen del envío se
-- calcula sumando el carrito en vez de cargarlo a mano. Nullable: si falta el dato y
-- la fuente es 'producto', el flujo de cotización (F2+) advierte y cae a manual.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS peso_kg  DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS largo_cm DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS ancho_cm DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS alto_cm  DECIMAL(10,2);

COMMENT ON COLUMN productos.peso_kg  IS 'ISS-174: peso unitario (kg) para cotizar envíos cuando envio_peso_fuente=producto.';
COMMENT ON COLUMN productos.largo_cm IS 'ISS-174: largo (cm) del bulto para peso volumétrico.';
COMMENT ON COLUMN productos.ancho_cm IS 'ISS-174: ancho (cm) del bulto para peso volumétrico.';
COMMENT ON COLUMN productos.alto_cm  IS 'ISS-174: alto (cm) del bulto para peso volumétrico.';
