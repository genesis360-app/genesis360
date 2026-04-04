-- Migration 030: Devoluciones
--
-- Agrega soporte para devoluciones de ventas (despachadas o facturadas).
-- El stock devuelto ingresa en una ubicación y estado marcados como "de devolución".
-- Para productos serializados, se reactivan las series originales.
-- Si el medio de pago incluye efectivo, se registra un egreso en caja.

-- ─── 1. Flags de devolución en ubicaciones y estados ─────────────────────────

ALTER TABLE ubicaciones        ADD COLUMN IF NOT EXISTS es_devolucion BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE estados_inventario ADD COLUMN IF NOT EXISTS es_devolucion BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ubicaciones.es_devolucion        IS 'Ubic. destino del stock devuelto (solo una por tenant)';
COMMENT ON COLUMN estados_inventario.es_devolucion IS 'Estado asignado al stock devuelto (solo uno por tenant)';

-- ─── 2. Tabla devoluciones ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devoluciones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id    UUID        NOT NULL REFERENCES ventas(id),
  numero_nc   TEXT,                                    -- "NC-{venta.numero}-{n}" solo si facturada
  origen      TEXT        NOT NULL CHECK (origen IN ('despachada', 'facturada')),
  motivo      TEXT,
  monto_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  medio_pago  TEXT,                                    -- JSON string [{tipo, monto}] igual que ventas
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devoluciones_tenant ON devoluciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_venta  ON devoluciones(venta_id);

-- ─── 3. Tabla devolucion_items ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devolucion_items (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id            UUID        NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
  producto_id              UUID        NOT NULL REFERENCES productos(id),
  cantidad                 INT         NOT NULL DEFAULT 1,
  precio_unitario          DECIMAL(12,2) NOT NULL DEFAULT 0,
  inventario_linea_nueva_id UUID       REFERENCES inventario_lineas(id)  -- solo no serializado
);

CREATE INDEX IF NOT EXISTS idx_devolucion_items_dev ON devolucion_items(devolucion_id);

-- ─── 4. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE devoluciones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE devolucion_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- devoluciones: SELECT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='devoluciones' AND policyname='dev_tenant_select') THEN
    CREATE POLICY dev_tenant_select ON devoluciones FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  -- devoluciones: INSERT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='devoluciones' AND policyname='dev_tenant_insert') THEN
    CREATE POLICY dev_tenant_insert ON devoluciones FOR INSERT
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  -- devolucion_items: SELECT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='devolucion_items' AND policyname='devitem_tenant_select') THEN
    CREATE POLICY devitem_tenant_select ON devolucion_items FOR SELECT
      USING (devolucion_id IN (
        SELECT id FROM devoluciones
        WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
  -- devolucion_items: INSERT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='devolucion_items' AND policyname='devitem_tenant_insert') THEN
    CREATE POLICY devitem_tenant_insert ON devolucion_items FOR INSERT
      WITH CHECK (devolucion_id IN (
        SELECT id FROM devoluciones
        WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
END $$;
