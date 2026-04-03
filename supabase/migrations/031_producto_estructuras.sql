-- Migration 031: Maestro de estructura de producto
-- Tabla producto_estructuras: define UoM por nivel (unidad / caja / pallet) para cada SKU

CREATE TABLE producto_estructuras (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id     UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre          TEXT        NOT NULL,
  is_default      BOOLEAN     NOT NULL DEFAULT false,

  -- Conversiones entre niveles
  unidades_por_caja   INT,
  cajas_por_pallet    INT,

  -- Nivel Unidad (kg / cm)
  peso_unidad    DECIMAL(10,4),
  alto_unidad    DECIMAL(10,2),
  ancho_unidad   DECIMAL(10,2),
  largo_unidad   DECIMAL(10,2),

  -- Nivel Caja (kg / cm)
  peso_caja      DECIMAL(10,4),
  alto_caja      DECIMAL(10,2),
  ancho_caja     DECIMAL(10,2),
  largo_caja     DECIMAL(10,2),

  -- Nivel Pallet (kg / cm)
  peso_pallet    DECIMAL(10,4),
  alto_pallet    DECIMAL(10,2),
  ancho_pallet   DECIMAL(10,2),
  largo_pallet   DECIMAL(10,2),

  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Un único default por producto por tenant
CREATE UNIQUE INDEX idx_producto_estructuras_default
  ON producto_estructuras (tenant_id, producto_id)
  WHERE is_default = true;

CREATE INDEX idx_producto_estructuras_producto ON producto_estructuras (producto_id);
CREATE INDEX idx_producto_estructuras_tenant   ON producto_estructuras (tenant_id);

-- updated_at automático
CREATE TRIGGER tr_producto_estructuras_updated_at
  BEFORE UPDATE ON producto_estructuras
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE producto_estructuras ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='producto_estructuras' AND policyname='pe_tenant_select') THEN
    CREATE POLICY pe_tenant_select ON producto_estructuras FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='producto_estructuras' AND policyname='pe_tenant_insert') THEN
    CREATE POLICY pe_tenant_insert ON producto_estructuras FOR INSERT
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='producto_estructuras' AND policyname='pe_tenant_update') THEN
    CREATE POLICY pe_tenant_update ON producto_estructuras FOR UPDATE
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='producto_estructuras' AND policyname='pe_tenant_delete') THEN
    CREATE POLICY pe_tenant_delete ON producto_estructuras FOR DELETE
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
