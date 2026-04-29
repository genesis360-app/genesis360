-- Migration 081: mejoras módulo Clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS etiquetas       TEXT[];
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_fiscal   TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS regimen_fiscal  TEXT;

-- Historial de notas por cliente (append-only con fecha y usuario)
CREATE TABLE IF NOT EXISTS cliente_notas (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  texto      TEXT NOT NULL,
  usuario_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cli_notas_cliente ON cliente_notas(cliente_id);
ALTER TABLE cliente_notas ENABLE ROW LEVEL SECURITY;
CREATE POLICY cli_notas_tenant ON cliente_notas
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
