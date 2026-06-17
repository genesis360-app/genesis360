-- migration 224: CRM de leads del panel interno (Fase 3).
--
-- Pipeline comercial (lead → qualified → demo → trial → won/lost). Gestionado por el rol
-- marketing/admin. Toda lectura/escritura vía EF admin-api (service_role); RLS default-deny.

CREATE TABLE IF NOT EXISTS leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           TEXT NOT NULL,
  empresa          TEXT,
  email            TEXT,
  telefono         TEXT,
  estado           TEXT NOT NULL DEFAULT 'lead'
                     CHECK (estado IN ('lead','qualified','demo','trial','won','lost')),
  valor_estimado   NUMERIC(12,2),       -- MRR potencial del deal
  origen           TEXT,                -- referido, web, ads, etc.
  notas            TEXT,
  asignado_a       UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  tenant_id        UUID REFERENCES tenants(id) ON DELETE SET NULL,  -- si se convirtió en cliente
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_asignado ON leads(asignado_a);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- Sin policies para authenticated → solo la EF admin-api (service_role).

COMMENT ON TABLE leads IS 'Panel interno: pipeline CRM de leads (marketing/admin). Gestionado vía EF admin-api.';
