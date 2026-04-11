-- Migration 039: Arqueos parciales de caja (sin cerrar sesión)
-- Permite registrar conteos físicos en cualquier momento durante la sesión

CREATE TABLE IF NOT EXISTS caja_arqueos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id UUID NOT NULL REFERENCES caja_sesiones(id) ON DELETE CASCADE,
  saldo_calculado DECIMAL(12,2) NOT NULL,
  saldo_real DECIMAL(12,2) NOT NULL,
  diferencia DECIMAL(12,2) GENERATED ALWAYS AS (saldo_real - saldo_calculado) STORED,
  notas TEXT,
  usuario_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE caja_arqueos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'caja_arqueos' AND policyname = 'tenant_caja_arqueos'
  ) THEN
    CREATE POLICY tenant_caja_arqueos ON caja_arqueos
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_caja_arqueos_sesion ON caja_arqueos(sesion_id);
CREATE INDEX IF NOT EXISTS idx_caja_arqueos_tenant ON caja_arqueos(tenant_id, created_at DESC);
