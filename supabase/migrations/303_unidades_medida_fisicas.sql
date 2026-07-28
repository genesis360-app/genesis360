-- ============================================================
-- 303_unidades_medida_fisicas.sql
-- FASE 1 del rediseño UoM/Empaque/Variantes (ver diseño-uom-empaque-variantes.html).
--
-- Separa la Unidad de Medida FÍSICA (conversión universal fija: 1 kg = 1000 g, siempre) del
-- Nivel de Empaque (Caja/Pallet, factor por producto). Decisión G1 de GO (2026-07-23): TABLAS
-- SEPARADAS. Esta migración crea `unidades_medida_fisicas` (nueva) con familias + factores
-- universales, la seedea por tenant, y agrega `productos.unidad_medida_base_id` (FK a la nueva
-- tabla) con backfill de mejor esfuerzo desde el texto legacy `productos.unidad_medida`.
--
-- ES ADITIVA: no toca `unidades_medida` (que en fases siguientes quedará solo para nombres de
-- empaque), no dropea la columna legacy `productos.unidad_medida` (se mantiene en sincronía
-- desde el frontend hasta que todos los consumidores lean el FK — limpieza de fase posterior).
--
-- Modelo: cada familia tiene una unidad BASE atómica (factor 1) y las demás convierten a ella.
--   Peso     → base Gramo:     mg=0.001 · g=1 · kg=1000 · t=1000000
--   Volumen  → base Mililitro:  ml=1 · L=1000
--   Longitud → base Metro:      mm=0.001 · cm=0.01 · m=1 · km=1000
--   Conteo   → base Unidad:     u=1  (única, sin decimales)
-- `permite_decimales` = (familia <> 'conteo'). El factor entre dos unidades de la MISMA familia
-- es factor_base_familia(desde) / factor_base_familia(hacia) — exacto, universal.
-- ============================================================

-- ── 1) Tabla ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unidades_medida_fisicas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  familia             text NOT NULL CHECK (familia IN ('peso','volumen','longitud','conteo')),
  nombre              text NOT NULL,
  simbolo             text,
  factor_base_familia numeric NOT NULL CHECK (factor_base_familia > 0),
  es_base_familia     boolean NOT NULL DEFAULT false,
  permite_decimales   boolean NOT NULL DEFAULT true,
  predefinida         boolean NOT NULL DEFAULT false,
  activo              boolean NOT NULL DEFAULT true,
  orden               int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nombre)
);

COMMENT ON TABLE unidades_medida_fisicas IS
  'Catálogo de Unidades de Medida FÍSICAS por tenant (Peso/Volumen/Longitud/Conteo). factor_base_familia = cuántas unidades base atómicas de la familia equivale (universal y fijo). Fase 1 del rediseño UoM/Empaque/Variantes.';

CREATE INDEX IF NOT EXISTS idx_umf_tenant ON unidades_medida_fisicas (tenant_id) WHERE activo = true;

ALTER TABLE unidades_medida_fisicas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'unidades_medida_fisicas' AND policyname = 'umf_tenant') THEN
    CREATE POLICY umf_tenant ON unidades_medida_fisicas FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON unidades_medida_fisicas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON unidades_medida_fisicas TO authenticated;
GRANT ALL ON unidades_medida_fisicas TO service_role;

-- ── 2) Seed idempotente (SECURITY DEFINER: el trigger de alta de tenant corre antes de que
-- exista la fila en users — mismo criterio que seed_tipos_pedido, mig 292) ──────────────
CREATE OR REPLACE FUNCTION seed_unidades_medida_fisicas(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO unidades_medida_fisicas
    (tenant_id, familia, nombre, simbolo, factor_base_familia, es_base_familia, permite_decimales, predefinida, orden)
  VALUES
    (p_tenant_id, 'conteo',   'Unidad',     'u',  1,       true,  false, true, 10),
    (p_tenant_id, 'peso',     'Miligramo',  'mg', 0.001,   false, true,  true, 20),
    (p_tenant_id, 'peso',     'Gramo',      'g',  1,       true,  true,  true, 21),
    (p_tenant_id, 'peso',     'Kilogramo',  'kg', 1000,    false, true,  true, 22),
    (p_tenant_id, 'peso',     'Tonelada',   't',  1000000, false, true,  true, 23),
    (p_tenant_id, 'volumen',  'Mililitro',  'ml', 1,       true,  true,  true, 30),
    (p_tenant_id, 'volumen',  'Litro',      'L',  1000,    false, true,  true, 31),
    (p_tenant_id, 'longitud', 'Milímetro',  'mm', 0.001,   false, true,  true, 40),
    (p_tenant_id, 'longitud', 'Centímetro', 'cm', 0.01,    false, true,  true, 41),
    (p_tenant_id, 'longitud', 'Metro',      'm',  1,       true,  true,  true, 42),
    (p_tenant_id, 'longitud', 'Kilómetro',  'km', 1000,    false, true,  true, 43)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_unidades_medida_fisicas(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger de alta de tenant (además del fn_seed_tenant_defaults grande, que no se toca)
CREATE OR REPLACE FUNCTION trg_seed_umf_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_unidades_medida_fisicas(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_umf ON tenants;
CREATE TRIGGER trg_seed_umf
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_seed_umf_new_tenant();

-- ── 3) Backfill de tenants existentes ────────────────────────────────────────────────
DO $$
DECLARE t_id uuid;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    PERFORM seed_unidades_medida_fisicas(t_id);
  END LOOP;
END $$;

-- ── 4) productos.unidad_medida_base_id (FK a la nueva tabla) ──────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS unidad_medida_base_id uuid REFERENCES unidades_medida_fisicas(id) ON DELETE SET NULL;

COMMENT ON COLUMN productos.unidad_medida_base_id IS
  'Unidad de Medida física base del producto (FK a unidades_medida_fisicas). Reemplaza gradualmente al texto legacy productos.unidad_medida (que se mantiene en sincronía desde el frontend por compatibilidad hasta la limpieza de fase posterior).';

CREATE INDEX IF NOT EXISTS idx_productos_unidad_medida_base ON productos (unidad_medida_base_id);

-- Backfill de mejor esfuerzo desde el texto legacy. Los que no matchean (caja/pack/docena/
-- custom = empaque, no unidad física) quedan NULL a propósito → el form pide elegir una.
UPDATE productos p
SET unidad_medida_base_id = umf.id
FROM unidades_medida_fisicas umf
WHERE umf.tenant_id = p.tenant_id
  AND p.unidad_medida_base_id IS NULL
  AND p.unidad_medida IS NOT NULL
  AND (
        lower(trim(p.unidad_medida)) = lower(umf.nombre)
     OR lower(trim(p.unidad_medida)) = lower(umf.simbolo)
     OR (lower(trim(p.unidad_medida)) IN ('gr')      AND umf.nombre = 'Gramo')
     OR (lower(trim(p.unidad_medida)) IN ('lt','l')  AND umf.nombre = 'Litro')
     OR (lower(trim(p.unidad_medida)) IN ('mt')      AND umf.nombre = 'Metro')
     OR (lower(trim(p.unidad_medida)) IN ('unid','un') AND umf.nombre = 'Unidad')
  );
