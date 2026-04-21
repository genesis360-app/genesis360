-- Migration 050: Recepciones / ASN + Conteo de Inventario + Estructura en LPN

-- ── 1. Nuevos estados en ordenes_compra ─────────────────────────────────────
ALTER TABLE ordenes_compra
  DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
    CHECK (estado IN ('borrador','enviada','confirmada','cancelada','recibida_parcial','recibida'));

-- ── 2. Tabla recepciones ─────────────────────────────────────────────────────
CREATE TABLE recepciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero         INT NOT NULL DEFAULT 0,
  oc_id          UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  proveedor_id   UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  estado         TEXT NOT NULL DEFAULT 'borrador'
                   CHECK (estado IN ('borrador','confirmada','cancelada')),
  notas          TEXT,
  sucursal_id    UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_fn_set_recepcion_numero()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_numero INT;
BEGIN
  IF NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
    FROM recepciones WHERE tenant_id = NEW.tenant_id;
    NEW.numero := v_numero;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_recepcion_numero
  BEFORE INSERT ON recepciones
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_recepcion_numero();

CREATE TRIGGER trg_updated_at_recepcion
  BEFORE UPDATE ON recepciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='recepciones' AND policyname='recepciones_tenant') THEN
    CREATE POLICY recepciones_tenant ON recepciones
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ── 3. Tabla recepcion_items ─────────────────────────────────────────────────
CREATE TABLE recepcion_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id         UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  producto_id          UUID NOT NULL REFERENCES productos(id),
  oc_item_id           UUID REFERENCES orden_compra_items(id) ON DELETE SET NULL,
  cantidad_esperada    DECIMAL(12,3) DEFAULT 0,
  cantidad_recibida    DECIMAL(12,3) NOT NULL DEFAULT 0,
  estado_id            UUID REFERENCES estados_inventario(id) ON DELETE SET NULL,
  ubicacion_id         UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  nro_lote             TEXT,
  fecha_vencimiento    DATE,
  lpn                  TEXT,
  series_txt           TEXT,
  inventario_linea_id  UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  precio_costo         DECIMAL(14,2)
);

ALTER TABLE recepcion_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='recepcion_items' AND policyname='recepcion_items_tenant') THEN
    CREATE POLICY recepcion_items_tenant ON recepcion_items
      USING (recepcion_id IN (
        SELECT id FROM recepciones
        WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
END $$;

-- ── 4. estructura_id en inventario_lineas ────────────────────────────────────
ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS estructura_id UUID REFERENCES producto_estructuras(id) ON DELETE SET NULL;

-- ── 5. Tabla inventario_conteos ──────────────────────────────────────────────
CREATE TABLE inventario_conteos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'ubicacion'
                  CHECK (tipo IN ('ubicacion','producto')),
  ubicacion_id  UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  producto_id   UUID REFERENCES productos(id) ON DELETE SET NULL,
  estado        TEXT NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','finalizado')),
  notas         TEXT,
  ajuste_aplicado BOOLEAN DEFAULT FALSE,
  sucursal_id   UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_updated_at_conteo
  BEFORE UPDATE ON inventario_conteos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inventario_conteos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventario_conteos' AND policyname='conteos_tenant') THEN
    CREATE POLICY conteos_tenant ON inventario_conteos
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ── 6. Tabla inventario_conteo_items ─────────────────────────────────────────
CREATE TABLE inventario_conteo_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conteo_id            UUID NOT NULL REFERENCES inventario_conteos(id) ON DELETE CASCADE,
  inventario_linea_id  UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  producto_id          UUID NOT NULL REFERENCES productos(id),
  lpn                  TEXT,
  cantidad_esperada    DECIMAL(12,3) NOT NULL DEFAULT 0,
  cantidad_contada     DECIMAL(12,3) NOT NULL DEFAULT 0
);

ALTER TABLE inventario_conteo_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventario_conteo_items' AND policyname='conteo_items_tenant') THEN
    CREATE POLICY conteo_items_tenant ON inventario_conteo_items
      USING (conteo_id IN (
        SELECT id FROM inventario_conteos
        WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
END $$;

-- ── 7. Índices ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recepciones_tenant ON recepciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_oc ON recepciones(oc_id) WHERE oc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recepcion_items_recepcion ON recepcion_items(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_conteos_tenant ON inventario_conteos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conteo_items_conteo ON inventario_conteo_items(conteo_id);
CREATE INDEX IF NOT EXISTS idx_inv_lineas_estructura ON inventario_lineas(estructura_id) WHERE estructura_id IS NOT NULL;
