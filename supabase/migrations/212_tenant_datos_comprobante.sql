-- Migration 212: Datos del emisor para comprobantes (paridad Xubio + extras de cobro)
--
-- Campos que aparecen en factura/presupuesto/remito y que hoy no existían:
-- - Datos fiscales del emisor: Ingresos Brutos + Inicio de Actividades (Xubio los muestra).
-- - Datos bancarios para cobro por transferencia (CBU / Alias / Banco) — pie del comprobante.
-- - Leyenda libre + sitio web (telefono/email ya existen en tenants desde mig 001).
-- Todos opcionales (NULL). Aditiva e idempotente.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ingresos_brutos     TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inicio_actividades  DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cbu                 TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alias_cbu           TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banco               TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS leyenda_comprobante TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sitio_web           TEXT;
