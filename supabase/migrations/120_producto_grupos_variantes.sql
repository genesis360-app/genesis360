-- Migration 120: Grupos de variantes de producto
-- Un grupo agrupa múltiples SKUs que son variantes entre sí (ej: Remera S/M/L en Azul/Rojo).
-- Cada SKU sigue siendo un producto normal con su propio stock, precio y LPNs.

CREATE TABLE IF NOT EXISTS producto_grupos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  imagen_url    TEXT,
  precio_base   NUMERIC DEFAULT 0,
  categoria_id  UUID REFERENCES categorias(id) ON DELETE SET NULL,
  -- atributos: array de {nombre, valores[]}
  -- Ej: [{"nombre":"Talle","valores":["S","M","L"]},{"nombre":"Color","valores":["Azul","Rojo"]}]
  atributos     JSONB NOT NULL DEFAULT '[]',
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE producto_grupos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='producto_grupos' AND policyname='tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON producto_grupos
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_producto_grupos_tenant ON producto_grupos(tenant_id);

-- Vincular productos a un grupo + guardar sus valores de variante
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS grupo_id        UUID REFERENCES producto_grupos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variante_valores JSONB;
  -- variante_valores ej: {"Talle": "M", "Color": "Azul"}

CREATE INDEX IF NOT EXISTS idx_productos_grupo ON productos(grupo_id);
