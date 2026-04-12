-- Migration 040: KITs / Kitting (WMS Fase 2.5)
-- Un KIT es un producto compuesto por N componentes (otros SKUs existentes).
-- El proceso de kitting rebaja componentes e ingresa el KIT en una sola operación.

-- Tabla de recetas de kits: qué componentes tiene cada KIT y en qué cantidad
CREATE TABLE IF NOT EXISTS kit_recetas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kit_producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  comp_producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad         DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kit_producto_id, comp_producto_id)
);

ALTER TABLE kit_recetas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kit_recetas' AND policyname = 'kit_recetas_tenant'
  ) THEN
    CREATE POLICY "kit_recetas_tenant" ON kit_recetas
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kit_recetas_kit    ON kit_recetas(kit_producto_id);
CREATE INDEX IF NOT EXISTS idx_kit_recetas_comp   ON kit_recetas(comp_producto_id);
CREATE INDEX IF NOT EXISTS idx_kit_recetas_tenant ON kit_recetas(tenant_id);

-- Tabla de registros de operaciones de kitting realizadas (auditoría)
CREATE TABLE IF NOT EXISTS kitting_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kit_producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_kits    DECIMAL(12,3) NOT NULL CHECK (cantidad_kits > 0),
  ubicacion_id     UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  usuario_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kitting_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kitting_log' AND policyname = 'kitting_log_tenant'
  ) THEN
    CREATE POLICY "kitting_log_tenant" ON kitting_log
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kitting_log_tenant ON kitting_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kitting_log_kit    ON kitting_log(kit_producto_id);

-- Columna es_kit en productos (marca que este producto tiene receta de kitting)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_kit BOOLEAN DEFAULT FALSE;
-- Tipo de movimiento 'kitting' ya debe estar en el CHECK de movimientos_stock.tipo
-- si no existe, se agrega:
DO $$
BEGIN
  -- Verificar si el constraint existe y si 'kitting' ya está incluido
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'movimientos_stock' AND column_name = 'tipo'
  ) THEN
    -- Droppear el constraint viejo y recrearlo con kitting incluido
    ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
    ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
      CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting'));
  END IF;
END $$;
