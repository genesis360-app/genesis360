-- ============================================================
-- Migration 187 — Compras · CO6 (Cheques diferidos)
--   D4 tabla de cheques (cobro futuro + alerta) + endoso (pagar a otro
--   proveedor con un cheque de tercero). Aditiva e idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS cheques (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero_interno INTEGER,                 -- correlativo por tenant (trigger)
  tipo          TEXT NOT NULL DEFAULT 'propio',  -- 'propio' (emitido por el negocio) | 'tercero' (recibido)
  nro_cheque    TEXT,                     -- número impreso en el cheque
  banco         TEXT,
  monto         NUMERIC NOT NULL DEFAULT 0,
  fecha_emision DATE,
  fecha_cobro   DATE,                     -- fecha diferida de cobro/pago (para la alerta)
  estado        TEXT NOT NULL DEFAULT 'en_cartera',
  -- 'en_cartera' | 'entregado' | 'depositado' | 'cobrado' | 'endosado' | 'rechazado' | 'anulado'
  proveedor_id  UUID REFERENCES proveedores(id) ON DELETE SET NULL,            -- a quién se entregó (propio) o se endosó (tercero)
  endosado_a_proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,  -- redundante con proveedor_id al endosar; explicita el endoso
  cliente_origen TEXT,                    -- de quién vino (cheque de tercero)
  oc_id         UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  sucursal_id   UUID REFERENCES sucursales(id),
  notas         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cheques_tenant ON cheques(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cheques_estado ON cheques(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_cheques_fecha_cobro ON cheques(tenant_id, fecha_cobro);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'cheques_tipo_check' AND table_name = 'cheques') THEN
    ALTER TABLE cheques ADD CONSTRAINT cheques_tipo_check
      CHECK (tipo IN ('propio', 'tercero'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'cheques_estado_check' AND table_name = 'cheques') THEN
    ALTER TABLE cheques ADD CONSTRAINT cheques_estado_check
      CHECK (estado IN ('en_cartera', 'entregado', 'depositado', 'cobrado', 'endosado', 'rechazado', 'anulado'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cheques' AND policyname='cheques_tenant') THEN
    CREATE POLICY "cheques_tenant" ON cheques FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Correlativo interno por tenant.
CREATE OR REPLACE FUNCTION set_cheque_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero_interno IS NULL OR NEW.numero_interno = 0 THEN
    SELECT COALESCE(MAX(numero_interno), 0) + 1 INTO NEW.numero_interno
      FROM cheques WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.set_cheque_numero() SET search_path = public;
DROP TRIGGER IF EXISTS trg_set_cheque_numero ON cheques;
CREATE TRIGGER trg_set_cheque_numero
  BEFORE INSERT ON cheques
  FOR EACH ROW EXECUTE FUNCTION set_cheque_numero();

-- Config: días de anticipación para alertar cheques próximos a cobrar.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cheques_alerta_dias INTEGER NOT NULL DEFAULT 7;
