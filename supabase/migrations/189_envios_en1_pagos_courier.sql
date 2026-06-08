-- Migration 189 — Envíos EN1: pagos a courier contables + conciliación
-- Relevamiento Envíos C1-C4. Cierra el gap: hoy "marcar pagado" es solo un flag (costo_pagado).
-- Ahora genera un gasto contable (categoría "Transporte y fletes", IVA crédito fiscal) SOLO para
-- courier tercero, descuenta de caja si efectivo, y permite cargar la factura del courier para
-- conciliar contra lo registrado (alerta de diferencias). Doble firma por umbral (C4).
-- Todo aditivo / idempotente.

-- ============================================================
-- 1) envios — link al gasto generado + a la factura del courier
-- ============================================================
ALTER TABLE envios ADD COLUMN IF NOT EXISTS gasto_id            UUID REFERENCES gastos(id) ON DELETE SET NULL;
ALTER TABLE envios ADD COLUMN IF NOT EXISTS courier_factura_id  UUID;  -- FK lógica a courier_facturas (sin hard FK por orden de carga)

CREATE INDEX IF NOT EXISTS idx_envios_gasto_id ON envios(gasto_id) WHERE gasto_id IS NOT NULL;

-- ============================================================
-- 2) tenants — config EN1 (Config → Envíos)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_courier_genera_gasto     BOOLEAN  NOT NULL DEFAULT TRUE;  -- C2: al pagar courier tercero genera gasto
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_courier_iva_pct          NUMERIC  NOT NULL DEFAULT 21;    -- alícuota IVA del flete (crédito fiscal)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_pago_doble_firma_umbral  NUMERIC  NOT NULL DEFAULT 0;     -- C4: 0 = sin doble firma

COMMENT ON COLUMN tenants.envio_courier_genera_gasto    IS 'EN1/C2: al marcar pagado un courier tercero, genera gasto contable (Transporte y fletes) con IVA crédito fiscal.';
COMMENT ON COLUMN tenants.envio_courier_iva_pct         IS 'EN1/C2: alícuota IVA del flete del courier (default 21). El costo del courier se toma bruto (IVA incluido).';
COMMENT ON COLUMN tenants.envio_pago_doble_firma_umbral IS 'EN1/C4: si > 0, pagos a courier por encima del umbral exigen clave maestra (doble firma).';

-- ============================================================
-- 3) courier_facturas (C3) — factura del courier para conciliar
-- ============================================================
CREATE TABLE IF NOT EXISTS courier_facturas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  courier          TEXT NOT NULL,
  nro_factura      TEXT,
  periodo_desde    DATE,
  periodo_hasta    DATE,
  total_facturado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_registrado NUMERIC(12,2) NOT NULL DEFAULT 0,  -- snapshot de lo registrado al conciliar
  diferencia       NUMERIC(12,2) NOT NULL DEFAULT 0,  -- facturado - registrado
  archivo_url      TEXT,
  estado           TEXT NOT NULL DEFAULT 'borrador',  -- borrador | conciliada
  notas            TEXT,
  sucursal_id      UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courier_facturas_tenant ON courier_facturas(tenant_id);
ALTER TABLE courier_facturas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='courier_facturas_tenant' AND tablename='courier_facturas') THEN
    CREATE POLICY "courier_facturas_tenant" ON courier_facturas
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- 4) courier_factura_lineas (C3) — match por envío
-- ============================================================
CREATE TABLE IF NOT EXISTS courier_factura_lineas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  factura_id       UUID NOT NULL REFERENCES courier_facturas(id) ON DELETE CASCADE,
  envio_id         UUID REFERENCES envios(id) ON DELETE SET NULL,
  monto_registrado NUMERIC(12,2) NOT NULL DEFAULT 0,  -- costo_cotizado del envío
  monto_facturado  NUMERIC(12,2),                     -- lo que figura en la factura del courier (editable)
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courier_factura_lineas_factura ON courier_factura_lineas(factura_id);
ALTER TABLE courier_factura_lineas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='courier_factura_lineas_tenant' AND tablename='courier_factura_lineas') THEN
    CREATE POLICY "courier_factura_lineas_tenant" ON courier_factura_lineas
      FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE courier_facturas       IS 'EN1/C3: factura del courier (período) para conciliar contra los envíos registrados.';
COMMENT ON TABLE courier_factura_lineas IS 'EN1/C3: líneas de la conciliación factura courier ↔ envío (registrado vs facturado).';
