-- Migration 163: ISS-174 F1 — código postal estructurado en origen y destino
--
-- Las APIs de courier cotizan por CP de origen (sucursal) y destino (domicilio del
-- cliente). Las direcciones de texto libre de Google no alcanzan.
--
-- NOTA: ambas columnas YA EXISTÍAN (sucursales.codigo_postal en mig 124;
-- cliente_domicilios.codigo_postal en mig 074). Esta migration es idempotente
-- (IF NOT EXISTS) y solo re-documenta el propósito para ISS-174. F1 agrega el
-- autocompletado best-effort del CP desde Google/Nominatim en los forms.

ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT;

ALTER TABLE cliente_domicilios
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT;

COMMENT ON COLUMN sucursales.codigo_postal        IS 'ISS-174: CP de origen para cotización de envíos por courier.';
COMMENT ON COLUMN cliente_domicilios.codigo_postal IS 'ISS-174: CP de destino para cotización de envíos por courier.';
