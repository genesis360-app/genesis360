-- Migration 137: Bóveda — tabla de retiros + backfill cuenta_origen_id en movimientos históricos
-- Reglas de negocio Caja · Tanda 1.5 (v1.9.2)
--
-- Relevamiento Gastón + socio (2026-05-25), respuesta a "/goal":
-- - La caja fuerte/bóveda funciona como billetera del negocio con todos los medios de pago
-- - Solo el DUEÑO puede extraer dinero de la bóveda
-- - El historial de retiros solo es visible para el DUEÑO (RLS estricta)
-- - Backfill: asignar cuenta_origen_id a movimientos informativos históricos según el concepto
--   (formato [Nombre del Método] ...) para que la vista vw_boveda_cuentas refleje todo el capital

-- ============================================================
-- 1) Tabla boveda_retiros — registro detallado de cada extracción
-- ============================================================
CREATE TABLE IF NOT EXISTS boveda_retiros (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuenta_origen_id  UUID REFERENCES cuentas_origen(id) ON DELETE RESTRICT,
  monto             DECIMAL(14,2) NOT NULL CHECK (monto > 0),
  tipo_retiro       TEXT NOT NULL DEFAULT 'otro'
    CHECK (tipo_retiro IN ('banco','retiro_personal','gasto','inversion','pago_proveedor','otro')),
  motivo            TEXT NOT NULL,
  notas             TEXT,
  usuario_id        UUID NOT NULL REFERENCES users(id),
  movimiento_id     UUID REFERENCES caja_movimientos(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boveda_retiros_tenant ON boveda_retiros(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boveda_retiros_cuenta ON boveda_retiros(cuenta_origen_id) WHERE cuenta_origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boveda_retiros_usuario ON boveda_retiros(usuario_id);

ALTER TABLE boveda_retiros ENABLE ROW LEVEL SECURITY;

-- RLS estricta: solo DUEÑO, ADMIN y SUPER_USUARIO ven los retiros (lectura y escritura)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='boveda_retiros_solo_dueno' AND tablename='boveda_retiros') THEN
    CREATE POLICY "boveda_retiros_solo_dueno" ON boveda_retiros FOR ALL
      USING (
        tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = auth.uid()
            AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO')
        )
      )
      WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM users
          WHERE id = auth.uid()
            AND rol IN ('DUEÑO','ADMIN','SUPER_USUARIO')
        )
      );
  END IF;
END $$;

COMMENT ON TABLE  boveda_retiros IS 'Registro detallado de retiros de bóveda (capital del negocio). Solo DUEÑO/ADMIN/SUPER_USUARIO pueden ver o crear retiros (RLS). Cada retiro lleva un movimiento de caja asociado (egreso_informativo) para descontar el saldo de la cuenta_origen.';
COMMENT ON COLUMN boveda_retiros.tipo_retiro IS 'banco | retiro_personal | gasto | inversion | pago_proveedor | otro';

-- ============================================================
-- 2) Backfill: asignar cuenta_origen_id a movimientos informativos históricos
-- ============================================================
-- Convención: el concepto empieza con [Nombre del Método] (ej: "[Mercado Pago] Venta #123")
-- Hacemos match case-insensitive con metodos_pago.nombre y aplicamos su cuenta_origen_id default.

UPDATE caja_movimientos cm
SET cuenta_origen_id = mp.cuenta_origen_id
FROM metodos_pago mp
WHERE cm.cuenta_origen_id IS NULL
  AND cm.tipo IN ('ingreso_informativo','egreso_informativo')
  AND cm.tenant_id = mp.tenant_id
  AND mp.cuenta_origen_id IS NOT NULL
  AND cm.concepto ~* ('^\[' || regexp_replace(mp.nombre, '([.()\[\]\\*+?^$|])', '\\\1', 'g') || '\]');

-- Asignar cuenta efectivo a los traspasos efectivo (ingreso_traspaso / egreso_traspaso)
-- y a los movimientos ingreso / egreso reales (efectivo) que tampoco tenían cuenta.
UPDATE caja_movimientos cm
SET cuenta_origen_id = co.id
FROM cuentas_origen co
WHERE cm.cuenta_origen_id IS NULL
  AND cm.tipo IN ('ingreso','egreso','ingreso_traspaso','egreso_traspaso',
                  'ingreso_reserva','egreso_devolucion_sena','ingreso_apertura')
  AND cm.tenant_id = co.tenant_id
  AND co.tipo = 'efectivo'
  AND co.activo = TRUE;

-- ============================================================
-- 3) Garantía: cada tenant tiene 1 sola cuenta tipo='efectivo' (índice único parcial)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_origen_efectivo_por_tenant
  ON cuentas_origen(tenant_id)
  WHERE tipo = 'efectivo';
