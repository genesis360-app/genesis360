-- Migration 130: tabla categorias_gasto + seed por tenant
-- Reglas de negocio Gastos · Fase 1 (v1.8.42)
-- Catálogo base predefinido + custom. Predefinidas se desactivan, no se eliminan.
-- categorias_gasto.requiere_sucursal define obligatoriedad de sucursal_id en gastos de esa categoría.

-- ============================================================
-- 1) Tabla categorias_gasto
-- ============================================================
CREATE TABLE IF NOT EXISTS categorias_gasto (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre             TEXT NOT NULL,
  requiere_sucursal  BOOLEAN NOT NULL DEFAULT FALSE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  predefinida        BOOLEAN NOT NULL DEFAULT FALSE,
  orden              INT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_categorias_gasto_tenant ON categorias_gasto(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categorias_gasto_activo ON categorias_gasto(tenant_id, activo) WHERE activo;

ALTER TABLE categorias_gasto ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='categorias_gasto_tenant' AND tablename='categorias_gasto') THEN
    CREATE POLICY "categorias_gasto_tenant" ON categorias_gasto
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE  categorias_gasto IS 'Catálogo de categorías de gasto por tenant. Predefinidas vienen seed al alta del tenant.';
COMMENT ON COLUMN categorias_gasto.requiere_sucursal IS 'Si true, el gasto con esta categoría obliga sucursal_id (alquiler, servicios). Si false, gasto global (impuestos, SaaS).';
COMMENT ON COLUMN categorias_gasto.predefinida IS 'Si true, vino del seed. No se puede eliminar (solo desactivar).';

-- ============================================================
-- 2) FK opcional en gastos y gastos_fijos (retrocompat: mantenemos columna `categoria` TEXT)
-- ============================================================
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL;

ALTER TABLE gastos_fijos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_categoria_id        ON gastos(categoria_id)        WHERE categoria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_fijos_categoria_id  ON gastos_fijos(categoria_id)  WHERE categoria_id IS NOT NULL;

-- ============================================================
-- 3) Función seed_categorias_gasto(tenant_id) — idempotente
-- ============================================================
CREATE OR REPLACE FUNCTION seed_categorias_gasto(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden) VALUES
    (p_tenant_id, 'Alquiler',                       TRUE,  TRUE,  10),
    (p_tenant_id, 'Servicios (luz, gas, agua)',     TRUE,  TRUE,  20),
    (p_tenant_id, 'Internet y telefonía',           TRUE,  TRUE,  30),
    (p_tenant_id, 'Mercadería',                     TRUE,  TRUE,  40),
    (p_tenant_id, 'Insumos y suministros',          TRUE,  TRUE,  50),
    (p_tenant_id, 'Mantenimiento y reparaciones',   TRUE,  TRUE,  60),
    (p_tenant_id, 'Limpieza',                       TRUE,  TRUE,  70),
    (p_tenant_id, 'Marketing y publicidad',         FALSE, TRUE,  80),
    (p_tenant_id, 'Combustible',                    FALSE, TRUE,  90),
    (p_tenant_id, 'Transporte y fletes',            FALSE, TRUE, 100),
    (p_tenant_id, 'Impuestos y tasas',              FALSE, TRUE, 110),
    (p_tenant_id, 'Honorarios profesionales',       FALSE, TRUE, 120),
    (p_tenant_id, 'Comisiones bancarias',           FALSE, TRUE, 130),
    (p_tenant_id, 'SaaS y plataformas',             FALSE, TRUE, 140),
    (p_tenant_id, 'Capacitación',                   FALSE, TRUE, 150),
    (p_tenant_id, 'Otros',                          FALSE, TRUE, 999)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

-- ============================================================
-- 4) Backfill — seed para tenants existentes
-- ============================================================
DO $$
DECLARE t_id UUID;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    PERFORM seed_categorias_gasto(t_id);
  END LOOP;
END $$;

-- ============================================================
-- 5) Trigger AFTER INSERT en tenants — seed automático para nuevos
-- ============================================================
CREATE OR REPLACE FUNCTION fn_seed_categorias_gasto_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_categorias_gasto(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_categorias_gasto_new_tenant ON tenants;
CREATE TRIGGER trg_seed_categorias_gasto_new_tenant
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION fn_seed_categorias_gasto_new_tenant();
