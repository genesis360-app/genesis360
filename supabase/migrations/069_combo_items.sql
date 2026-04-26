-- Migration 069: combo_items — soporte multi-SKU para combos
-- Cada combo ahora tiene N productos en combo_items; migra combos existentes (single-SKU)

CREATE TABLE combo_items (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  combo_id   UUID NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad   INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_combo_items_combo_id  ON combo_items(combo_id);
CREATE INDEX idx_combo_items_tenant_id ON combo_items(tenant_id);

ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY combo_items_tenant ON combo_items
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Migrar combos existentes (single-SKU) a combo_items
INSERT INTO combo_items (tenant_id, combo_id, producto_id, cantidad)
SELECT tenant_id, id, producto_id, COALESCE(cantidad, 1)
FROM combos
WHERE producto_id IS NOT NULL AND activo = true;

-- Hacer nullable las columnas legacy (ya cubiertas por combo_items)
ALTER TABLE combos ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE combos ALTER COLUMN cantidad    DROP NOT NULL;
