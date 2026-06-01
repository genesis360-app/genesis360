-- Migration 168: VF2 (I1+I2) — canales de venta configurables + reglas online/presencial
--
-- I1: catálogo de canales por tenant con clasificación 'online' | 'presencial'.
--     Reemplaza el array hardcodeado del POS. MP NO se seedea (es medio de pago).
-- I2: reglas que pueden diferir por clasificación (plazo devolución, descuento máx,
--     lista de precios por defecto, requisito de cliente/factura) en tenants.reglas_canal.

CREATE TABLE IF NOT EXISTS canales_venta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  clasificacion TEXT NOT NULL DEFAULT 'presencial' CHECK (clasificacion IN ('online','presencial')),
  icono         TEXT,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  predefinido   BOOLEAN NOT NULL DEFAULT FALSE,
  orden         INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_canales_venta_tenant ON canales_venta(tenant_id);

ALTER TABLE canales_venta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='canales_venta_tenant' AND tablename='canales_venta') THEN
    CREATE POLICY "canales_venta_tenant" ON canales_venta FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Seed idempotente (SECURITY DEFINER: el trigger corre al alta del tenant, antes de users — ver mig 166)
CREATE OR REPLACE FUNCTION seed_canales_venta(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO canales_venta (tenant_id, nombre, clasificacion, icono, predefinido, orden) VALUES
    (p_tenant_id, 'Presencial',   'presencial', '🏪', TRUE, 10),
    (p_tenant_id, 'Instagram',    'online',     '📸', TRUE, 20),
    (p_tenant_id, 'Facebook',     'online',     '👤', TRUE, 30),
    (p_tenant_id, 'WhatsApp',     'online',     '💬', TRUE, 40),
    (p_tenant_id, 'MercadoLibre', 'online',     '🛒', TRUE, 50),
    (p_tenant_id, 'TiendaNube',   'online',     '🛍️', TRUE, 60),
    (p_tenant_id, 'Otros',        'presencial', '📦', TRUE, 99)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

DO $$ DECLARE t_id UUID; BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP PERFORM seed_canales_venta(t_id); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION fn_seed_canales_venta_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM seed_canales_venta(NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_seed_canales_venta_new_tenant ON tenants;
CREATE TRIGGER trg_seed_canales_venta_new_tenant
  AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION fn_seed_canales_venta_new_tenant();

-- I2: reglas por clasificación. {online:{devolucion_dias,descuento_max_pct,lista_precio,requiere_cliente}, presencial:{...}}
-- NULL en un campo = sin override (usa la regla general del tenant).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reglas_canal JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE  canales_venta IS 'VF2/I1: canales de venta por tenant + clasificación online/presencial. MP no es canal (es medio de pago).';
COMMENT ON COLUMN tenants.reglas_canal IS 'VF2/I2: reglas distintas por clasificación {online:{devolucion_dias,descuento_max_pct,lista_precio,requiere_cliente},presencial:{...}}.';
