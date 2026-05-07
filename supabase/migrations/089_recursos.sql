-- Migration 089: Módulo Recursos — patrimonio e inventario del negocio (no para vender)
CREATE TABLE recursos (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre            TEXT        NOT NULL,
  descripcion       TEXT,
  categoria         TEXT        NOT NULL DEFAULT 'otro',
  estado            TEXT        NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo','en_reparacion','dado_de_baja','pendiente_adquisicion')),
  valor             DECIMAL(12,2),          -- valor de compra (existente) o presupuesto estimado (pendiente)
  fecha_adquisicion DATE,
  proveedor_id      UUID        REFERENCES proveedores(id) ON DELETE SET NULL,
  ubicacion         TEXT,
  numero_serie      TEXT,
  garantia_hasta    DATE,
  notas             TEXT,
  sucursal_id       UUID        REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recursos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recursos_tenant" ON recursos
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE TRIGGER trg_recursos_updated_at
  BEFORE UPDATE ON recursos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_recursos_tenant       ON recursos(tenant_id);
CREATE INDEX idx_recursos_tenant_estado ON recursos(tenant_id, estado);
