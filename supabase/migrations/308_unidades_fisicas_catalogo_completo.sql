-- ============================================================
-- 308_unidades_fisicas_catalogo_completo.sql
-- FASE 1-bis del rediseño UoM/Empaque/Variantes (decisión B2/H1 de Fede, 2026-07-24):
-- Config → Inventario → "Unidades" = catálogo COMPLETO de unidades físicas + enable/disable por
-- tenant + presets por rubro (los presets viven en el frontend; acá va el catálogo y el flag).
--
-- Cambios:
--   (1) Nueva familia 'area' (m²/cm²/hectárea) — se relaja el CHECK de `familia`.
--   (2) Catálogo ampliado: métrico + imperial (onza, libra, galón, pulgada, pie, milla…) + área.
--       Las de uso común quedan activas; las poco usadas (imperial, m³, área ≠ m²) quedan
--       INACTIVAS por default (activo=false) — el tenant las prende desde la config si las necesita.
--   (3) El seed pasa a setear `activo` explícito y se re-corre para todos los tenants (ON CONFLICT
--       DO NOTHING → solo inserta las unidades que faltan; NO pisa el activo de las ya existentes,
--       que el tenant pudo haber togggleado).
--
-- NO toca stock/precios/fiscal. La conversión de un producto lee `factor_base_familia` (universal
-- y fijo), que no cambia; desactivar una unidad solo la oculta de los selectores nuevos.
-- `es_base_familia` no se puede desactivar (es el ancla de conversión de la familia — guard en UI).
-- ============================================================

-- ── 1) Relajar el CHECK de familia para admitir 'area' ────────────────────────────────
ALTER TABLE unidades_medida_fisicas DROP CONSTRAINT IF EXISTS unidades_medida_fisicas_familia_check;
ALTER TABLE unidades_medida_fisicas
  ADD CONSTRAINT unidades_medida_fisicas_familia_check
  CHECK (familia IN ('peso','volumen','longitud','conteo','area'));

-- ── 2) Seed ampliado (idempotente, SECURITY DEFINER — mismo criterio que mig 303) ─────
CREATE OR REPLACE FUNCTION seed_unidades_medida_fisicas(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO unidades_medida_fisicas
    (tenant_id, familia, nombre, simbolo, factor_base_familia, es_base_familia, permite_decimales, predefinida, activo, orden)
  VALUES
    -- Conteo (base Unidad, entero). Docena = conversión universal fija (12 u), inactiva por default.
    (p_tenant_id, 'conteo',   'Unidad',            'u',   1,             true,  false, true, true,  10),
    (p_tenant_id, 'conteo',   'Docena',            'doc', 12,            false, false, true, false, 11),
    (p_tenant_id, 'conteo',   'Millar',            'mil', 1000,          false, false, true, false, 12),
    -- Peso (base Gramo)
    (p_tenant_id, 'peso',     'Miligramo',         'mg',  0.001,         false, true,  true, true,  20),
    (p_tenant_id, 'peso',     'Gramo',             'g',   1,             true,  true,  true, true,  21),
    (p_tenant_id, 'peso',     'Kilogramo',         'kg',  1000,          false, true,  true, true,  22),
    (p_tenant_id, 'peso',     'Tonelada',          't',   1000000,       false, true,  true, true,  23),
    (p_tenant_id, 'peso',     'Onza',              'oz',  28.349523125,  false, true,  true, false, 24),
    (p_tenant_id, 'peso',     'Libra',             'lb',  453.59237,     false, true,  true, false, 25),
    -- Volumen (base Mililitro)
    (p_tenant_id, 'volumen',  'Mililitro',         'ml',  1,             true,  true,  true, true,  30),
    (p_tenant_id, 'volumen',  'Centilitro',        'cl',  10,            false, true,  true, false, 31),
    (p_tenant_id, 'volumen',  'Litro',             'L',   1000,          false, true,  true, true,  32),
    (p_tenant_id, 'volumen',  'Metro cúbico',      'm³',  1000000,       false, true,  true, false, 33),
    -- Galón/onza líquida = definición US customary (no UK imperial: gal UK = 4546.09 ml).
    (p_tenant_id, 'volumen',  'Onza líquida (US)', 'fl oz', 29.5735295625, false, true, true, false, 34),
    (p_tenant_id, 'volumen',  'Galón (US)',        'gal', 3785.411784,   false, true,  true, false, 35),
    -- Longitud (base Metro)
    (p_tenant_id, 'longitud', 'Milímetro',         'mm',  0.001,         false, true,  true, true,  40),
    (p_tenant_id, 'longitud', 'Centímetro',        'cm',  0.01,          false, true,  true, true,  41),
    (p_tenant_id, 'longitud', 'Metro',             'm',   1,             true,  true,  true, true,  42),
    (p_tenant_id, 'longitud', 'Kilómetro',         'km',  1000,          false, true,  true, true,  43),
    (p_tenant_id, 'longitud', 'Pulgada',           'in',  0.0254,        false, true,  true, false, 44),
    (p_tenant_id, 'longitud', 'Pie',               'ft',  0.3048,        false, true,  true, false, 45),
    (p_tenant_id, 'longitud', 'Yarda',             'yd',  0.9144,        false, true,  true, false, 46),
    (p_tenant_id, 'longitud', 'Milla',             'mi',  1609.344,      false, true,  true, false, 47),
    -- Área (base Metro cuadrado) — familia nueva
    (p_tenant_id, 'area',     'Centímetro cuadrado','cm²', 0.0001,       false, true,  true, false, 50),
    (p_tenant_id, 'area',     'Metro cuadrado',    'm²',  1,             true,  true,  true, true,  51),
    (p_tenant_id, 'area',     'Hectárea',          'ha',  10000,         false, true,  true, false, 52),
    (p_tenant_id, 'area',     'Kilómetro cuadrado','km²', 1000000,       false, true,  true, false, 53)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_unidades_medida_fisicas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_unidades_medida_fisicas(uuid) TO service_role;

-- ── 3) Backfill: agrega las unidades nuevas a los tenants existentes (sin pisar activo) ─
DO $$
DECLARE t_id uuid;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    PERFORM seed_unidades_medida_fisicas(t_id);
  END LOOP;
END $$;
