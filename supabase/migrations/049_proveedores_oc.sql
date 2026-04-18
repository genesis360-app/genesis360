-- ============================================================
-- Migration 049: Proveedores extendido + Órdenes de Compra
-- ============================================================

-- ─── Nuevos campos en proveedores ────────────────────────────────────────────
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS razon_social    TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cuit            TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS domicilio       TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS condicion_iva   TEXT CHECK (condicion_iva IN ('responsable_inscripto','monotributo','exento','consumidor_final'));
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS plazo_pago_dias INT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS banco           TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cbu             TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS notas           TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS sucursal_id     UUID REFERENCES sucursales(id);

-- ─── Órdenes de Compra ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
  numero          INT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','enviada','confirmada','cancelada')),
  fecha_esperada  DATE,
  notas           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, numero)
);

CREATE TABLE IF NOT EXISTS orden_compra_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id  UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id),
  cantidad         DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario  DECIMAL(12,2),
  notas            TEXT
);

-- ─── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_tenant     ON ordenes_compra(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor  ON ordenes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_oc_items_orden            ON orden_compra_items(orden_compra_id);

-- ─── Trigger número auto-incremental por tenant ──────────────────────────────
CREATE OR REPLACE FUNCTION set_oc_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1
      INTO NEW.numero
      FROM ordenes_compra
     WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_oc_numero ON ordenes_compra;
CREATE TRIGGER trg_set_oc_numero
  BEFORE INSERT ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION set_oc_numero();

-- ─── Trigger updated_at ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at_oc()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_oc ON ordenes_compra;
CREATE TRIGGER trg_updated_at_oc
  BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_oc();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ordenes_compra     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_compra_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ordenes_compra' AND policyname = 'oc_tenant') THEN
    CREATE POLICY "oc_tenant" ON ordenes_compra FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orden_compra_items' AND policyname = 'oc_items_tenant') THEN
    CREATE POLICY "oc_items_tenant" ON orden_compra_items FOR ALL
      USING (orden_compra_id IN (
        SELECT id FROM ordenes_compra
         WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
END $$;
