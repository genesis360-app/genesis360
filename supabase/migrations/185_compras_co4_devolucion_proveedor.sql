-- ============================================================
-- Migration 185 — Compras · CO4 (Devolución a proveedor)
--   C1 entidad separada · C2 forma (crédito CC / efectivo / reposición) ·
--   C3 catálogo motivo + obs opcional · C4 sin plazo.
--   Aditiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS devoluciones_proveedor (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero        INTEGER,
  proveedor_id  UUID NOT NULL REFERENCES proveedores(id),
  oc_id         UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  recepcion_id  UUID REFERENCES recepciones(id) ON DELETE SET NULL,
  sucursal_id   UUID REFERENCES sucursales(id),
  forma         TEXT NOT NULL,        -- 'credito_cc' | 'efectivo' | 'reposicion'
  motivo        TEXT NOT NULL,        -- catálogo (C3)
  observacion   TEXT,                 -- libre opcional
  monto         NUMERIC NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL DEFAULT 'confirmada',
  caja_sesion_id     UUID REFERENCES caja_sesiones(id),  -- efectivo
  oc_reposicion_id   UUID REFERENCES ordenes_compra(id), -- reposición
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE devoluciones_proveedor ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_devprov_tenant ON devoluciones_proveedor(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devprov_proveedor ON devoluciones_proveedor(proveedor_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'devprov_forma_check' AND table_name = 'devoluciones_proveedor') THEN
    ALTER TABLE devoluciones_proveedor ADD CONSTRAINT devprov_forma_check
      CHECK (forma IN ('credito_cc', 'efectivo', 'reposicion'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devoluciones_proveedor' AND policyname='devprov_tenant') THEN
    CREATE POLICY "devprov_tenant" ON devoluciones_proveedor FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS devolucion_proveedor_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id  UUID NOT NULL REFERENCES devoluciones_proveedor(id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL REFERENCES productos(id),
  cantidad       NUMERIC NOT NULL,
  costo_unitario NUMERIC NOT NULL DEFAULT 0,
  lpn            TEXT
);
ALTER TABLE devolucion_proveedor_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_devprov_items_dev ON devolucion_proveedor_items(devolucion_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devolucion_proveedor_items' AND policyname='devprov_items_tenant') THEN
    CREATE POLICY "devprov_items_tenant" ON devolucion_proveedor_items FOR ALL
      USING (devolucion_id IN (SELECT id FROM devoluciones_proveedor WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())))
      WITH CHECK (devolucion_id IN (SELECT id FROM devoluciones_proveedor WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())));
  END IF;
END $$;

-- Correlativo por tenant.
CREATE OR REPLACE FUNCTION set_devprov_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
      FROM devoluciones_proveedor WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.set_devprov_numero() SET search_path = public;
DROP TRIGGER IF EXISTS trg_set_devprov_numero ON devoluciones_proveedor;
CREATE TRIGGER trg_set_devprov_numero
  BEFORE INSERT ON devoluciones_proveedor
  FOR EACH ROW EXECUTE FUNCTION set_devprov_numero();
