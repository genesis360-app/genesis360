-- Migration 074: domicilios de entrega por cliente (para módulo de Envíos)
CREATE TABLE IF NOT EXISTS cliente_domicilios (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre        TEXT,           -- alias: "Casa", "Trabajo", "Depósito"
  calle         TEXT NOT NULL,
  numero        TEXT,
  piso_depto    TEXT,
  ciudad        TEXT,
  provincia     TEXT,
  codigo_postal TEXT,
  referencias   TEXT,           -- indicaciones adicionales para el courier
  es_principal  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cli_dom_cliente ON cliente_domicilios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cli_dom_tenant  ON cliente_domicilios(tenant_id);

ALTER TABLE cliente_domicilios ENABLE ROW LEVEL SECURITY;
CREATE POLICY cli_dom_tenant ON cliente_domicilios
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
