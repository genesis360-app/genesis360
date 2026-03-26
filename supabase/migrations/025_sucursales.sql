-- Migration 025: Multi-sucursal
-- Tabla sucursales + sucursal_id nullable en 6 tablas operativas

-- ─── Tabla sucursales ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sucursales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  direccion    TEXT,
  telefono     TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sucursales_tenant ON sucursales(tenant_id);

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sucursales' AND policyname = 'tenant_sucursales') THEN
    CREATE POLICY tenant_sucursales ON sucursales
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── sucursal_id nullable en tablas operativas ─────────────────────────────────
ALTER TABLE inventario_lineas  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE movimientos_stock  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE ventas             ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE caja_sesiones      ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE gastos             ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);

-- ─── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventario_lineas_sucursal ON inventario_lineas(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_sucursal ON movimientos_stock(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_ventas_sucursal            ON ventas(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_sucursal     ON caja_sesiones(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_gastos_sucursal            ON gastos(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_clientes_sucursal          ON clientes(sucursal_id);
