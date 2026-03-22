-- Migration 008: módulo de gastos del negocio

CREATE TABLE IF NOT EXISTS gastos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descripcion   TEXT NOT NULL,
  monto         NUMERIC(12,2) NOT NULL,
  categoria     TEXT,
  medio_pago    TEXT,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id    UUID REFERENCES users(id),
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_tenant" ON gastos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
