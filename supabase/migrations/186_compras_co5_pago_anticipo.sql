-- ============================================================
-- Migration 186 — Compras · CO5 (Pago: anticipo + contra-entrega + schedule)
--   D1 modo de pago por proveedor + % anticipo · OC marca "paga con anticipo"
--      (+ snapshot del %) · D2 schedule de pago configurable por OC (opcional).
--   D3 (transferencia con comprobante) reusa el comprobante a nivel OC (ISS-096),
--      sin columna nueva.
--   Aditiva e idempotente. Sin DDL destructivo.
-- ============================================================

-- D1 — modo de pago por proveedor + % de anticipo configurable.
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS modo_pago TEXT NOT NULL DEFAULT 'contado',
  ADD COLUMN IF NOT EXISTS anticipo_pct NUMERIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'proveedores_modo_pago_check' AND table_name = 'proveedores') THEN
    ALTER TABLE proveedores ADD CONSTRAINT proveedores_modo_pago_check
      CHECK (modo_pago IN ('contado', 'anticipo', 'contra_entrega', 'cuenta_corriente'));
  END IF;
END $$;

-- D1 — la OC marca si se paga con anticipo (override opcional del % por OC, snapshot).
-- D2 — schedule de pago opcional por OC: arreglo JSONB de cuotas
--      [{ "etiqueta", "base": 'confirmacion'|'recepcion'|'dias', "dias"?, "pct" }].
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS paga_con_anticipo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anticipo_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pago_schedule JSONB;
