-- 273: Catálogo configurable de valores para los "Atributos de variante" (talle, color,
-- encaje, formato, sabor/aroma) de ProductoFormPage.
--
-- Contexto (pedido GO): esos 5 toggles (tiene_talle, tiene_color, tiene_encaje, tiene_formato,
-- tiene_sabor_aroma) ya capturaban el dato como TEXTO LIBRE al recibir stock (inventario_lineas
-- tiene esas columnas desde antes), pero: (a) no había dónde definir qué valores son válidos
-- (riesgo de "M" / "Mediana" / "m" fragmentando el stock sin que nadie lo note) y (b) el dato
-- no se leía en ningún otro lado — ni en la venta ni en las vistas de inventario. Esta migración
-- resuelve (a); el resto (selects en Recepciones/Ingreso manual, visibilidad y selección en
-- VentasPage) es código de aplicación en el mismo release.
--
-- Diseño: UNA tabla genérica con columna `atributo` (no 5 tablas) — los 5 atributos son
-- estructuralmente idénticos (una lista de valores válidos por tenant). `orden` permite que
-- "S, M, L, XL" se muestre en orden lógico y no alfabético.

CREATE TABLE IF NOT EXISTS atributos_variante_valores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atributo   text NOT NULL CHECK (atributo IN ('talle', 'color', 'encaje', 'formato', 'sabor_aroma')),
  valor      text NOT NULL CHECK (btrim(valor) <> ''),
  orden      integer NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE atributos_variante_valores IS
  'Catálogo por tenant de valores válidos para los atributos de variante (talle/color/encaje/formato/sabor_aroma) de productos. Se usa en Recepciones/Ingreso manual (carga) y en VentasPage (selección al vender). Ver ProductoFormPage "Atributos de variante".';

-- Un mismo valor no se repite (case-insensitive) dentro del mismo atributo y tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atributos_variante_valores_tenant_atributo_valor
  ON atributos_variante_valores (tenant_id, atributo, lower(btrim(valor)));
CREATE INDEX IF NOT EXISTS idx_atributos_variante_valores_tenant_atributo
  ON atributos_variante_valores (tenant_id, atributo) WHERE activo;

-- RLS: mismo patrón tenant-scoped que emisores_fiscales / motivos_movimiento.
ALTER TABLE atributos_variante_valores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'atributos_variante_valores' AND policyname = 'atributos_variante_valores_tenant') THEN
    CREATE POLICY atributos_variante_valores_tenant ON atributos_variante_valores FOR ALL
      USING (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())))
      WITH CHECK (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())));
  END IF;
END $$;

REVOKE ALL ON atributos_variante_valores FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON atributos_variante_valores TO authenticated;
GRANT ALL ON atributos_variante_valores TO service_role;

-- ── Backfill: sembrar el catálogo con lo que ya se cargó como texto libre ──────────────────
-- No toca inventario_lineas (esos valores históricos quedan como están, REGLA #0 — nunca se
-- reescribe inventario histórico). Solo copia los valores DISTINCT ya usados para que el
-- catálogo no arranque vacío para un tenant que ya venía tipeando talles a mano.
INSERT INTO atributos_variante_valores (tenant_id, atributo, valor)
SELECT DISTINCT il.tenant_id, 'talle', btrim(il.talle)
FROM inventario_lineas il
WHERE il.talle IS NOT NULL AND btrim(il.talle) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO atributos_variante_valores (tenant_id, atributo, valor)
SELECT DISTINCT il.tenant_id, 'color', btrim(il.color)
FROM inventario_lineas il
WHERE il.color IS NOT NULL AND btrim(il.color) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO atributos_variante_valores (tenant_id, atributo, valor)
SELECT DISTINCT il.tenant_id, 'encaje', btrim(il.encaje)
FROM inventario_lineas il
WHERE il.encaje IS NOT NULL AND btrim(il.encaje) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO atributos_variante_valores (tenant_id, atributo, valor)
SELECT DISTINCT il.tenant_id, 'formato', btrim(il.formato)
FROM inventario_lineas il
WHERE il.formato IS NOT NULL AND btrim(il.formato) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO atributos_variante_valores (tenant_id, atributo, valor)
SELECT DISTINCT il.tenant_id, 'sabor_aroma', btrim(il.sabor_aroma)
FROM inventario_lineas il
WHERE il.sabor_aroma IS NOT NULL AND btrim(il.sabor_aroma) <> ''
ON CONFLICT DO NOTHING;
