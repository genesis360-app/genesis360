-- migration 085: OC gestión de pagos + cuenta corriente con proveedores

-- ── 1. Campos de pago en ordenes_compra ─────────────────────────────────────
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado_pago IN ('pendiente_pago','pago_parcial','pagada','cuenta_corriente')),
  ADD COLUMN IF NOT EXISTS monto_total DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_pago DATE,
  ADD COLUMN IF NOT EXISTS dias_plazo_pago INT,
  ADD COLUMN IF NOT EXISTS condiciones_pago TEXT;

CREATE INDEX IF NOT EXISTS idx_oc_estado_pago ON ordenes_compra(tenant_id, estado_pago);
CREATE INDEX IF NOT EXISTS idx_oc_vencimiento ON ordenes_compra(tenant_id, fecha_vencimiento_pago)
  WHERE fecha_vencimiento_pago IS NOT NULL;

-- ── 2. Campos CC en proveedores ──────────────────────────────────────────────
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS limite_credito_proveedor DECIMAL(12,2);

-- ── 3. Tabla movimientos de cuenta corriente con proveedores ─────────────────
CREATE TABLE IF NOT EXISTS proveedor_cc_movimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  oc_id           UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL
    CHECK (tipo IN ('oc','pago','nota_credito','ajuste')),
  monto           DECIMAL(12,2) NOT NULL,  -- positivo = deuda, negativo = cancela deuda
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  medio_pago      TEXT,
  descripcion     TEXT,
  caja_sesion_id  UUID REFERENCES caja_sesiones(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcc_tenant_proveedor ON proveedor_cc_movimientos(tenant_id, proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pcc_oc ON proveedor_cc_movimientos(oc_id) WHERE oc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pcc_vencimiento ON proveedor_cc_movimientos(tenant_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

ALTER TABLE proveedor_cc_movimientos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'proveedor_cc_movimientos' AND policyname = 'pcc_tenant'
  ) THEN
    CREATE POLICY pcc_tenant ON proveedor_cc_movimientos
      FOR ALL USING (
        tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      );
  END IF;
END $$;

-- ── 4. Función helper: calcular saldo CC de un proveedor ─────────────────────
CREATE OR REPLACE FUNCTION fn_saldo_proveedor_cc(p_proveedor_id UUID)
RETURNS DECIMAL(12,2) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(monto), 0)
  FROM proveedor_cc_movimientos
  WHERE proveedor_id = p_proveedor_id;
$$;
