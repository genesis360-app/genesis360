-- Migration 028: campo dni en clientes
--
-- DNI es el identificador único del cliente por tenant.
-- Se agrega como nullable para no romper registros existentes,
-- pero se valida como obligatorio en la UI.
-- UNIQUE(tenant_id, dni) WHERE dni IS NOT NULL para evitar duplicados.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dni TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_dni_tenant
  ON clientes(tenant_id, dni)
  WHERE dni IS NOT NULL;

COMMENT ON COLUMN clientes.dni IS 'DNI/RUT del cliente. Único por tenant. Obligatorio en UI.';
