-- Migration 136: Caja — moneda por caja + Cuentas de Origen + bóveda discriminada
-- Reglas de negocio Caja · Tanda 1 (v1.9.1)
--
-- Relevamiento Gastón + socio (2026-05-25): respuestas A-I
-- - F1: cajas separadas por moneda (cada caja tiene su moneda fija)
-- - H1: Cuentas de Origen (BBVA, Mercado Pago, etc.) enlazadas a métodos de pago
--       Cada movimiento de caja informativo lleva cuenta_origen_id → la bóveda
--       muestra saldos discriminados por cuenta bancaria/billetera

-- ============================================================
-- 1) cajas.moneda — cada caja maneja una sola moneda
-- ============================================================
ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS';

COMMENT ON COLUMN cajas.moneda IS 'Código de moneda ISO 4217 (ARS, USD, etc.). Una caja maneja una sola moneda (relevamiento Caja F1).';

CREATE INDEX IF NOT EXISTS idx_cajas_moneda ON cajas(tenant_id, moneda);

-- Sembrar moneda desde tenant.moneda para cajas existentes
UPDATE cajas c
SET moneda = COALESCE(t.moneda, 'ARS')
FROM tenants t
WHERE c.tenant_id = t.id
  AND (c.moneda IS NULL OR c.moneda = 'ARS')
  AND t.moneda IS NOT NULL;

-- ============================================================
-- 2) Tabla cuentas_origen
-- ============================================================
CREATE TABLE IF NOT EXISTS cuentas_origen (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'banco'
    CHECK (tipo IN ('banco','billetera','efectivo','otro')),
  banco       TEXT,
  numero      TEXT,
  alias       TEXT,
  moneda      TEXT NOT NULL DEFAULT 'ARS',
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_cuentas_origen_tenant ON cuentas_origen(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_origen_activo ON cuentas_origen(tenant_id, activo) WHERE activo = TRUE;

ALTER TABLE cuentas_origen ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cuentas_origen_tenant' AND tablename='cuentas_origen') THEN
    CREATE POLICY "cuentas_origen_tenant" ON cuentas_origen FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE  cuentas_origen IS 'Cuentas bancarias / billeteras digitales / efectivo donde se acreditan los movimientos de caja. Permite ver bóveda discriminada por cuenta.';
COMMENT ON COLUMN cuentas_origen.tipo IS 'banco | billetera (MP, Ualá, etc.) | efectivo | otro';

-- ============================================================
-- 3) metodos_pago.cuenta_origen_id — cuenta default por método
-- ============================================================
ALTER TABLE metodos_pago
  ADD COLUMN IF NOT EXISTS cuenta_origen_id UUID
    REFERENCES cuentas_origen(id) ON DELETE SET NULL;

COMMENT ON COLUMN metodos_pago.cuenta_origen_id IS 'Cuenta default donde se acredita cada cobro con este método. Se puede sobreescribir en cada movimiento.';

CREATE INDEX IF NOT EXISTS idx_metodos_pago_cuenta_origen
  ON metodos_pago(cuenta_origen_id) WHERE cuenta_origen_id IS NOT NULL;

-- ============================================================
-- 4) caja_movimientos.cuenta_origen_id — opcional pero recomendado para informativos
-- ============================================================
ALTER TABLE caja_movimientos
  ADD COLUMN IF NOT EXISTS cuenta_origen_id UUID
    REFERENCES cuentas_origen(id) ON DELETE SET NULL;

COMMENT ON COLUMN caja_movimientos.cuenta_origen_id IS 'Cuenta de origen del movimiento (banco/billetera). NULL para efectivo o cuando no aplica.';

CREATE INDEX IF NOT EXISTS idx_caja_movimientos_cuenta_origen
  ON caja_movimientos(cuenta_origen_id) WHERE cuenta_origen_id IS NOT NULL;

-- ============================================================
-- 5) Vista vw_boveda_cuentas — saldos netos por cuenta de origen
-- ============================================================
CREATE OR REPLACE VIEW vw_boveda_cuentas
WITH (security_invoker = true)
AS
SELECT
  co.tenant_id,
  co.id              AS cuenta_origen_id,
  co.nombre,
  co.tipo,
  co.banco,
  co.moneda,
  co.activo,
  COALESCE(SUM(CASE
    WHEN cm.tipo LIKE 'ingreso%' THEN cm.monto
    WHEN cm.tipo LIKE 'egreso%'  THEN -cm.monto
    ELSE 0
  END), 0)::DECIMAL(14,2) AS saldo,
  COUNT(cm.id)       AS movimientos_count,
  MAX(cm.created_at) AS ultimo_movimiento_at
FROM cuentas_origen co
LEFT JOIN caja_movimientos cm ON cm.cuenta_origen_id = co.id
GROUP BY co.id, co.tenant_id, co.nombre, co.tipo, co.banco, co.moneda, co.activo;

COMMENT ON VIEW vw_boveda_cuentas IS 'Saldo neto por cuenta de origen (banco/billetera). Usado por tab Bóveda en CajaPage para mostrar conciliación virtual.';

-- ============================================================
-- 6) Seed inicial — cuenta "Efectivo" por tenant
-- ============================================================
-- Sembrar una cuenta "Efectivo" por tenant para que al menos exista una opción base.
INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
SELECT t.id, 'Efectivo', 'efectivo', COALESCE(t.moneda, 'ARS'), TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cuentas_origen co
  WHERE co.tenant_id = t.id AND co.tipo = 'efectivo'
);

-- Asignar la cuenta "Efectivo" al método de pago "Efectivo" donde exista
UPDATE metodos_pago mp
SET cuenta_origen_id = co.id
FROM cuentas_origen co
WHERE mp.tenant_id = co.tenant_id
  AND mp.cuenta_origen_id IS NULL
  AND LOWER(mp.nombre) = 'efectivo'
  AND co.tipo = 'efectivo';
