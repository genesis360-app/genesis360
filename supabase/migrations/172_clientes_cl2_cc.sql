-- ============================================================
-- Migration 172 — Relevamiento Clientes · Fase CL2
-- Cuenta corriente de clientes: límite + vencimiento + interés + morosidad.
--   B1 — enforcement configurable (permitir / avisar / bloquear) + límite default tenant
--   B3 — vencimiento por venta + interés de mora (% mensual), recálculo sweep-lazy
--   B4 — política de morosidad (permitir / bloqueo_cc / bloqueo_total)
-- Reusa `clientes.limite_credito` (límite por cliente, ya existe desde mig 083).
-- Aditiva e idempotente.
-- ============================================================

-- ── Config de tenant ──────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS limite_cc_default       DECIMAL(12,2),                      -- B1/D1 — límite general (NULL = sin límite)
  ADD COLUMN IF NOT EXISTS cc_enforcement_politica TEXT NOT NULL DEFAULT 'avisar',     -- B1 — permitir | avisar | bloquear
  ADD COLUMN IF NOT EXISTS cc_morosidad_politica   TEXT NOT NULL DEFAULT 'bloqueo_cc', -- B4 — permitir | bloqueo_cc | bloqueo_total
  ADD COLUMN IF NOT EXISTS cc_dias_vencimiento     INT,                                -- B3 — días para vencer una venta CC (NULL = sin venc.)
  ADD COLUMN IF NOT EXISTS cc_interes_mensual_pct  DECIMAL(6,3) NOT NULL DEFAULT 0;    -- B3 — % mensual de mora sobre saldo vencido

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_cc_enforcement_chk;
ALTER TABLE tenants ADD CONSTRAINT tenants_cc_enforcement_chk
  CHECK (cc_enforcement_politica IN ('permitir','avisar','bloquear'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_cc_morosidad_chk;
ALTER TABLE tenants ADD CONSTRAINT tenants_cc_morosidad_chk
  CHECK (cc_morosidad_politica IN ('permitir','bloqueo_cc','bloqueo_total'));

-- ── Datos por venta CC ────────────────────────────────────────────────────
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_cc DATE,                   -- B3 — vencimiento de esta venta CC
  ADD COLUMN IF NOT EXISTS interes_cc DECIMAL(12,2) NOT NULL DEFAULT 0; -- B3 — interés de mora acumulado (lo recalcula el sweep)

CREATE INDEX IF NOT EXISTS idx_ventas_cc_venc ON ventas(tenant_id, fecha_vencimiento_cc)
  WHERE es_cuenta_corriente = TRUE;

-- ── RPC: estado de CC de un cliente (deuda total + deuda vencida) ─────────
-- Usado por el POS para enforcement (B1) y morosidad (B4), y por la ficha.
-- SECURITY DEFINER + tenant-scoped: solo agrega ventas del tenant del usuario.
CREATE OR REPLACE FUNCTION cliente_cc_estado(p_cliente UUID)
RETURNS TABLE (deuda_total NUMERIC, deuda_vencida NUMERIC, interes_total NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc), 0) AS deuda_total,
    COALESCE(SUM(CASE WHEN v.fecha_vencimiento_cc IS NOT NULL
                       AND v.fecha_vencimiento_cc < CURRENT_DATE
                      THEN GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc ELSE 0 END), 0) AS deuda_vencida,
    COALESCE(SUM(v.interes_cc), 0) AS interes_total
  FROM ventas v
  WHERE v.cliente_id = p_cliente
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND v.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (v.total - v.monto_pagado) > 0.5;
$$;
GRANT EXECUTE ON FUNCTION cliente_cc_estado(UUID) TO authenticated;

-- ── RPC: recálculo de intereses de mora (sweep-lazy, idempotente) ─────────
-- Recalcula `interes_cc` desde cero para cada venta CC vencida del tenant:
--   interes = saldo_pendiente * (pct_mensual/100) * (días_vencido / 30)
-- Idempotente: al recomputar desde el saldo actual, correr 2 veces da igual.
-- Se invoca al entrar a Clientes/Caja (no hay pg_cron habilitado).
CREATE OR REPLACE FUNCTION recalcular_intereses_cc(p_tenant UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pct NUMERIC;
  v_count INT := 0;
BEGIN
  -- Seguridad: el usuario debe pertenecer al tenant
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND tenant_id = p_tenant) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(cc_interes_mensual_pct, 0) INTO v_pct FROM tenants WHERE id = p_tenant;
  IF v_pct IS NULL OR v_pct <= 0 THEN
    -- Sin interés configurado: limpiar cualquier interés previo y salir
    UPDATE ventas SET interes_cc = 0
      WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0;
    RETURN 0;
  END IF;

  UPDATE ventas v SET interes_cc = ROUND(
      GREATEST(v.total - v.monto_pagado, 0)
      * (v_pct / 100.0)
      * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
    , 2)
  WHERE v.tenant_id = p_tenant
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND v.fecha_vencimiento_cc IS NOT NULL
    AND (v.total - v.monto_pagado) > 0.5;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Ventas ya saldadas o no vencidas: interés en 0
  UPDATE ventas SET interes_cc = 0
    WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0
      AND ((total - monto_pagado) <= 0.5
           OR fecha_vencimiento_cc IS NULL
           OR fecha_vencimiento_cc >= CURRENT_DATE);

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION recalcular_intereses_cc(UUID) TO authenticated;
