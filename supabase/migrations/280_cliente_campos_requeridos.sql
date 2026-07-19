-- Migration 280 (backlog Config Ventas/Envíos, punto 4 — pedido Fede/GO 2026-07-19):
-- Campos requeridos del cliente en el POS pasan de un ENUM de 4 combinaciones fijas
-- (tenants.cliente_datos_minimos: nombre / nombre_dni / nombre_dni_email / todos — sin
-- teléfono como opción independiente) a un JSONB con un flag por campo:
--   {"dni": bool, "telefono": bool, "email": bool}   (el nombre es SIEMPRE obligatorio)
--
-- `cliente_datos_minimos` queda como columna LEGACY: la UI nueva escribe ambas (el enum se
-- sincroniza al valor más cercano) para no romper ningún lector viejo, y el helper
-- `camposRequeridosCliente` (src/lib/clienteCampos.ts) cae al enum si el jsonb es NULL.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS cliente_campos_requeridos jsonb;

COMMENT ON COLUMN public.tenants.cliente_campos_requeridos IS
  'Campos obligatorios al crear cliente desde el POS: {"dni":bool,"telefono":bool,"email":bool}. Nombre siempre obligatorio. NULL = derivar del enum legacy cliente_datos_minimos. Ver mig 280.';

-- Backfill idempotente desde el enum legacy (solo filas que aún no tienen el jsonb):
UPDATE public.tenants SET cliente_campos_requeridos = CASE cliente_datos_minimos
    WHEN 'todos'            THEN '{"dni":true,"telefono":true,"email":true}'::jsonb
    WHEN 'nombre_dni_email' THEN '{"dni":true,"telefono":false,"email":true}'::jsonb
    WHEN 'nombre_dni'       THEN '{"dni":true,"telefono":false,"email":false}'::jsonb
    ELSE '{"dni":false,"telefono":false,"email":false}'::jsonb
  END
WHERE cliente_campos_requeridos IS NULL;
