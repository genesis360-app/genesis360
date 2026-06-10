-- Migration 203: Caja — cierre del relevamiento (tanda final)
-- E3 arqueo manual de bóveda · L3 préstamo a empleado (doc firmada)
--
-- Reconciliación 2026-06-10: el relevamiento Caja (A-M, 2026-05-25) ya estaba casi
-- todo en PROD (migs 136-142, hito v1.10.0). Quedaban ítems chicos; esta migración
-- cubre los que requieren schema. E1 (bóveda para roles custom), M3 (panel cajero) y
-- M4 (sonido) son client-side y no tocan la DB.

-- ============================================================
-- 1) E3 — boveda_arqueos: arqueo manual de la bóveda (sin cerrarla)
-- ============================================================
-- La bóveda nunca se cierra; el DUEÑO puede contar el saldo cuando quiera y queda
-- registrado en el historial con fecha/hora/usuario/monto. Una fila por cuenta de
-- origen contada (cuenta_origen_id NULL = efectivo / caja fuerte tradicional).
CREATE TABLE IF NOT EXISTS boveda_arqueos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuenta_origen_id  UUID REFERENCES cuentas_origen(id) ON DELETE SET NULL,
  saldo_sistema     DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo_contado     DECIMAL(14,2) NOT NULL DEFAULT 0,
  diferencia        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- contado - sistema (+ sobrante / - faltante)
  notas             TEXT,
  usuario_id        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boveda_arqueos_tenant ON boveda_arqueos(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boveda_arqueos_cuenta ON boveda_arqueos(cuenta_origen_id) WHERE cuenta_origen_id IS NOT NULL;

ALTER TABLE boveda_arqueos ENABLE ROW LEVEL SECURITY;

-- RLS estricta: igual que boveda_retiros — solo DUEÑO/ADMIN/SUPER_USUARIO ven/crean arqueos.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='boveda_arqueos_solo_dueno' AND tablename='boveda_arqueos') THEN
    CREATE POLICY "boveda_arqueos_solo_dueno" ON boveda_arqueos FOR ALL
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

COMMENT ON TABLE  boveda_arqueos IS 'E3 relevamiento Caja: arqueos manuales de la bóveda (capital del negocio). Solo DUEÑO/ADMIN/SUPER_USUARIO (RLS). La bóveda nunca se cierra; el arqueo es opcional y queda en el historial.';
COMMENT ON COLUMN boveda_arqueos.diferencia IS 'saldo_contado - saldo_sistema (positivo = sobrante, negativo = faltante)';

-- ============================================================
-- 2) L3 — préstamo a empleado: documentación firmada + flag de préstamo
-- ============================================================
-- El "préstamo" reusa rrhh_anticipos (se descuenta del próximo sueldo y, si genera
-- gasto en efectivo, el egreso de caja sale por Gastos — consistente con G2/G3).
-- Falta solo: distinguir préstamo de anticipo simple + adjuntar la nota firmada.
ALTER TABLE rrhh_anticipos
  ADD COLUMN IF NOT EXISTS es_prestamo    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS documento_url  TEXT;

COMMENT ON COLUMN rrhh_anticipos.es_prestamo   IS 'L3 relevamiento Caja: TRUE = préstamo formal (con nota/documentación firmada); FALSE = anticipo simple de sueldo.';
COMMENT ON COLUMN rrhh_anticipos.documento_url IS 'L3: URL de la nota de préstamo firmada por el colaborador y RRHH (bucket empleados).';

-- GRANT obligatorio en tablas nuevas (Supabase deja de auto-exponer el schema public desde 2026-10-30).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boveda_arqueos TO authenticated;
