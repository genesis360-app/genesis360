-- ─── Migration 056: Sprint C — Tab Autorizaciones DEPOSITO ──────────────────

-- DEPOSITO genera solicitud en vez de ejecutar para:
--   ajuste_cantidad: editar cantidad de un LPN
--   eliminar_serie:  eliminar una serie del LPN
--   eliminar_lpn:    eliminar el LPN completo
CREATE TABLE IF NOT EXISTS autorizaciones_inventario (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('ajuste_cantidad', 'eliminar_serie', 'eliminar_lpn')),
  linea_id         UUID NOT NULL REFERENCES inventario_lineas(id),
  datos_cambio     JSONB NOT NULL DEFAULT '{}',
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por   UUID REFERENCES users(id),
  aprobado_por     UUID REFERENCES users(id),
  motivo_rechazo   TEXT,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE autorizaciones_inventario ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autorizaciones_inventario' AND policyname = 'aut_inv_tenant'
  ) THEN
    CREATE POLICY aut_inv_tenant ON autorizaciones_inventario
      FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aut_inv_tenant_estado
  ON autorizaciones_inventario(tenant_id, estado);

CREATE TRIGGER trg_updated_at_aut_inv
  BEFORE UPDATE ON autorizaciones_inventario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
