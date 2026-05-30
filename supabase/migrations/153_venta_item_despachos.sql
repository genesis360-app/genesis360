-- Migration 153: ISS-075 — Trazabilidad de despacho por LPN en ventas
--
-- Hoy venta_items.linea_id guarda un único LPN "principal" por ítem. Cuando
-- una venta despacha un ítem desde varios LPN/ubicaciones (ej: 10u = 6 de
-- LPN-A + 4 de LPN-B) se pierde el desglose: no se sabe de qué línea/ubicación
-- salió cada unidad.
--
-- Esta tabla registra cada PORCIÓN despachada de un venta_item: una fila por
-- (venta_item, linea de origen). Para items serializados se registra una fila
-- por serie. Los campos de texto (lpn, ubicacion_nombre, nro_serie) son
-- snapshots: si después se edita/elimina el LPN, la traza queda intacta.

CREATE TABLE IF NOT EXISTS venta_item_despachos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id         UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  venta_item_id    UUID NOT NULL REFERENCES venta_items(id) ON DELETE CASCADE,
  producto_id      UUID REFERENCES productos(id) ON DELETE SET NULL,
  linea_id         UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  lpn              TEXT,           -- snapshot del LPN de origen
  ubicacion_id     UUID,           -- referencia (puede quedar huérfana)
  ubicacion_nombre TEXT,           -- snapshot del nombre de la ubicación
  cantidad         NUMERIC NOT NULL,
  nro_serie        TEXT,           -- snapshot, solo items serializados
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vid_venta   ON venta_item_despachos(venta_id);
CREATE INDEX IF NOT EXISTS idx_vid_item    ON venta_item_despachos(venta_item_id);
CREATE INDEX IF NOT EXISTS idx_vid_tenant  ON venta_item_despachos(tenant_id);

ALTER TABLE venta_item_despachos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='venta_item_despachos_tenant' AND tablename='venta_item_despachos') THEN
    CREATE POLICY "venta_item_despachos_tenant" ON venta_item_despachos FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE venta_item_despachos IS
  'ISS-075: desglose de despacho por LPN/ubicación de cada venta_item. Una fila por porción (linea de origen) o por serie. Campos texto = snapshot intacto ante edición/borrado del LPN.';
