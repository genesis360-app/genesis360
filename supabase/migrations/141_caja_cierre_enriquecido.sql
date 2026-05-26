-- Migration 141: Caja Fase 2.1 — Ticket cierre + Snapshot + Diferencias
-- v1.9.4 — relevamiento C1/C3/K2/K3/B1/B2/B3/B4

-- ============================================================
-- 1) caja_sesiones.numero — correlativo por sucursal (K3)
-- ============================================================
ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS numero INT;

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_numero
  ON caja_sesiones(tenant_id, sucursal_id, numero DESC) WHERE numero IS NOT NULL;

-- Trigger BEFORE INSERT que asigna número correlativo por sucursal
CREATE OR REPLACE FUNCTION fn_set_caja_sesion_numero()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1
    INTO NEW.numero
    FROM caja_sesiones
    WHERE tenant_id = NEW.tenant_id
      AND COALESCE(sucursal_id::text, '_global') = COALESCE(NEW.sucursal_id::text, '_global');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_caja_sesion_numero ON caja_sesiones;
CREATE TRIGGER trg_set_caja_sesion_numero
  BEFORE INSERT ON caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION fn_set_caja_sesion_numero();

-- Backfill: numerar sesiones existentes por sucursal + abierta_at
WITH numeradas AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, COALESCE(sucursal_id::text, '_global')
      ORDER BY abierta_at
    ) AS rn
  FROM caja_sesiones
  WHERE numero IS NULL
)
UPDATE caja_sesiones cs
SET numero = n.rn
FROM numeradas n
WHERE cs.id = n.id;

COMMENT ON COLUMN caja_sesiones.numero IS 'Correlativo por sucursal (asignado por trigger AT INSERT). K3 del relevamiento Caja.';

-- ============================================================
-- 2) caja_sesiones.snapshot_totales — JSONB con detalle del cierre (K2)
-- ============================================================
ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS snapshot_totales JSONB;

COMMENT ON COLUMN caja_sesiones.snapshot_totales IS 'Snapshot al cierre — totales por método de pago, listado de ventas, listado de movimientos manuales, etc. Permite regenerar el ticket PDF idéntico en cualquier momento (K2 del relevamiento Caja).';

-- ============================================================
-- 3) tenants.diferencia_caja_* — umbral + roles + canales de alerta
-- ============================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS diferencia_caja_umbral          DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS diferencia_caja_alerta_roles    TEXT[] DEFAULT ARRAY['DUEÑO','SUPERVISOR'],
  ADD COLUMN IF NOT EXISTS diferencia_caja_alerta_canales  TEXT[] DEFAULT ARRAY['inapp','email'];

COMMENT ON COLUMN tenants.diferencia_caja_umbral          IS 'Umbral mínimo de diferencia (absoluto) para disparar alerta. NULL = alerta con cualquier diferencia. B1 del relevamiento Caja.';
COMMENT ON COLUMN tenants.diferencia_caja_alerta_roles    IS 'Roles que reciben alerta por diferencia de cierre. Default DUEÑO+SUPERVISOR. B2 del relevamiento Caja.';
COMMENT ON COLUMN tenants.diferencia_caja_alerta_canales  IS 'Canales por los que se envía la alerta: inapp | email | whatsapp. Default inapp+email. B3 del relevamiento Caja.';

-- ============================================================
-- 4) Vista vw_diferencias_por_cajero (B4) — reporte 30 días
-- ============================================================
CREATE OR REPLACE VIEW vw_diferencias_por_cajero
WITH (security_invoker = true)
AS
SELECT
  cs.tenant_id,
  cs.usuario_id,
  u.nombre_display AS cajero,
  COUNT(*)                                            AS cierres_count,
  SUM(CASE WHEN cs.diferencia_cierre <> 0 THEN 1 ELSE 0 END)::INT AS cierres_con_diferencia,
  COALESCE(SUM(cs.diferencia_cierre), 0)::DECIMAL(14,2) AS diferencia_neta_acumulada,
  COALESCE(SUM(ABS(cs.diferencia_cierre)), 0)::DECIMAL(14,2) AS diferencia_absoluta_acumulada,
  COALESCE(MAX(ABS(cs.diferencia_cierre)), 0)::DECIMAL(14,2) AS diferencia_maxima
FROM caja_sesiones cs
LEFT JOIN users u ON u.id = cs.usuario_id
WHERE cs.estado = 'cerrada'
  AND cs.cerrada_at >= NOW() - INTERVAL '30 days'
  AND cs.diferencia_cierre IS NOT NULL
GROUP BY cs.tenant_id, cs.usuario_id, u.nombre_display;

COMMENT ON VIEW vw_diferencias_por_cajero IS 'Diferencias acumuladas por cajero en los últimos 30 días. B4 del relevamiento Caja — sin descuento automático, solo trazabilidad.';
