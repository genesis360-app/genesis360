-- Migration 097: recurso_id en gastos + tabla gasto_cuotas

-- Link gastos → recursos (igual que gastos → recepciones)
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS recurso_id UUID REFERENCES recursos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS es_cuota        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cuotas_total    INT,
  ADD COLUMN IF NOT EXISTS monto_cuota     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tasa_interes    NUMERIC(5,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gastos_recurso ON gastos(recurso_id) WHERE recurso_id IS NOT NULL;

-- Cuotas mensuales de un gasto financiado con tarjeta
CREATE TABLE IF NOT EXISTS gasto_cuotas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gasto_id         UUID NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  numero           INT  NOT NULL,           -- 1, 2, 3...
  monto            NUMERIC(12,2) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado')),
  fecha_pago       DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gasto_cuotas_gasto ON gasto_cuotas(gasto_id);

ALTER TABLE gasto_cuotas ENABLE ROW LEVEL SECURITY;
