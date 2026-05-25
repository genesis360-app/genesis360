-- Migration 133: moneda del tenant + alícuota IVA en gastos + autorizaciones_cc
-- Reglas de negocio Gastos · Fase 3 (v1.8.44)

-- ============================================================
-- 1) Moneda principal del tenant (etiqueta visual, sin conversión)
-- ============================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS'
    CHECK (moneda IN ('ARS','USD','CLP','UYU','PYG','BOB','BRL','PEN','MXN','COP','EUR'));

COMMENT ON COLUMN tenants.moneda IS 'Moneda principal del negocio. Etiqueta visual para formateo de precios; no implica conversión automática.';

-- ============================================================
-- 2) Alícuota de IVA en gastos (selector 21/10.5/27/0/custom)
-- ============================================================
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2);

ALTER TABLE gastos_fijos
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2);

COMMENT ON COLUMN gastos.alicuota_iva       IS 'Alícuota IVA aplicada (21 / 10.5 / 27 / 0 / custom). NULL = no aplica IVA.';
COMMENT ON COLUMN gastos_fijos.alicuota_iva IS 'Alícuota IVA del gasto fijo (heredada al generar gasto).';

-- ============================================================
-- 3) Autorizaciones de CC (override DUEÑO para crear OC con CC bloqueada)
-- ============================================================
CREATE TABLE IF NOT EXISTS autorizaciones_cc (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  oc_id           UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  motivo_bloqueo  TEXT NOT NULL CHECK (motivo_bloqueo IN ('limite_excedido','oc_vencida')),
  monto           DECIMAL(12,2),
  motivo          TEXT,
  solicitante_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  solicitante_rol TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),
  aprobador_id    UUID REFERENCES users(id),
  aprobador_rol   TEXT,
  resolved_at     TIMESTAMPTZ,
  motivo_rechazo  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autoriz_cc_tenant_estado ON autorizaciones_cc(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_autoriz_cc_proveedor    ON autorizaciones_cc(proveedor_id, estado);

ALTER TABLE autorizaciones_cc ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='autoriz_cc_tenant' AND tablename='autorizaciones_cc') THEN
    CREATE POLICY "autoriz_cc_tenant" ON autorizaciones_cc FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE  autorizaciones_cc IS 'Autorizaciones del DUEÑO para crear OC con cuenta corriente cuando el proveedor está bloqueado (límite excedido o OC vencida).';
COMMENT ON COLUMN autorizaciones_cc.motivo_bloqueo IS 'limite_excedido (saldo CC del proveedor superó el límite) | oc_vencida (tiene OC con CC vencida sin pagar)';
