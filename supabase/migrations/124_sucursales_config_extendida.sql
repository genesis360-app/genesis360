-- Migration 124: Sucursales — campos de configuración extendida
ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS codigo_postal     TEXT,
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS horario_apertura  TIME,
  ADD COLUMN IF NOT EXISTS horario_cierre    TIME,
  ADD COLUMN IF NOT EXISTS punto_venta_afip  INTEGER;

COMMENT ON COLUMN sucursales.punto_venta_afip IS 'Número de punto de venta AFIP asignado a esta sucursal';
