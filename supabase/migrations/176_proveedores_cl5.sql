-- ============================================================
-- Migration 176 — Relevamiento Clientes · Fase CL5 (CC proveedores)
--   D6 — Múltiples cuentas bancarias por proveedor (tabla nueva).
--   D4 — Notas de crédito de proveedor con correlativo + adjunto.
-- (D2 bloqueo por deuda vencida y D5 pago parcial ya existen en el modelo de
--  `proveedor_cc_movimientos`; D3 estado de cuenta PDF se resuelve en app.)
-- ============================================================

-- D6 — Cuentas bancarias múltiples por proveedor -----------------------------
CREATE TABLE IF NOT EXISTS proveedor_cuentas_bancarias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  banco        TEXT,
  titular      TEXT,
  cbu          TEXT,
  alias        TEXT,
  cuenta       TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prov_cuentas_proveedor ON proveedor_cuentas_bancarias(proveedor_id);
ALTER TABLE proveedor_cuentas_bancarias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proveedor_cuentas_bancarias' AND policyname = 'prov_cuentas_tenant') THEN
    CREATE POLICY prov_cuentas_tenant ON proveedor_cuentas_bancarias FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- D4 — Correlativo + adjunto para notas de crédito de proveedor --------------
ALTER TABLE proveedor_cc_movimientos
  ADD COLUMN IF NOT EXISTS nc_numero   TEXT,   -- correlativo de la NC (ej: NC-0001)
  ADD COLUMN IF NOT EXISTS adjunto_url TEXT;   -- comprobante PDF/imagen
