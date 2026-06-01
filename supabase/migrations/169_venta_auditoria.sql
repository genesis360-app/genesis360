-- Migration 169: VF3 (J1) — audit log detallado por venta
--
-- Registra acciones sensibles sobre una venta (anulación, cambio de cliente, override
-- de descuento, edición de ítems) con su detalle, para mostrarlas en el modal de la venta.

CREATE TABLE IF NOT EXISTS venta_auditoria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  accion          TEXT NOT NULL,          -- 'anulacion' | 'cambio_cliente' | 'override_descuento' | 'edicion_items' | ...
  detalle         JSONB,                  -- {antes, despues, motivo, ...}
  usuario_id      UUID,
  usuario_nombre  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_venta_auditoria_venta ON venta_auditoria(venta_id, created_at);

ALTER TABLE venta_auditoria ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='venta_auditoria_tenant' AND tablename='venta_auditoria') THEN
    CREATE POLICY "venta_auditoria_tenant" ON venta_auditoria FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE venta_auditoria IS 'VF3/J1: audit log detallado por venta (acciones sensibles + diff), visible en el modal de la venta.';
