-- Migration 142: Caja Fase 2.4 — Reportes (HITO v1.10.0)
-- I1/I2 del relevamiento

-- ============================================================
-- Vista vw_caja_resumen_diario — agregado por día/caja/sucursal
-- Se usa para los reportes (a) diario por caja y (b) consolidado
-- ============================================================
CREATE OR REPLACE VIEW vw_caja_resumen_diario
WITH (security_invoker = true)
AS
SELECT
  cs.tenant_id,
  DATE(cs.abierta_at) AS fecha,
  cs.sucursal_id,
  s.nombre              AS sucursal_nombre,
  cs.caja_id,
  c.nombre              AS caja_nombre,
  c.moneda              AS moneda,
  COUNT(*)::INT                                                    AS sesiones_count,
  COUNT(*) FILTER (WHERE cs.estado = 'cerrada')::INT               AS sesiones_cerradas,
  COALESCE(SUM(cs.monto_apertura), 0)::DECIMAL(14,2)               AS total_apertura,
  COALESCE(SUM(cs.total_ingresos), 0)::DECIMAL(14,2)               AS total_ingresos,
  COALESCE(SUM(cs.total_egresos), 0)::DECIMAL(14,2)                AS total_egresos,
  COALESCE(SUM(cs.total_ventas), 0)::DECIMAL(14,2)                 AS total_ventas,
  COALESCE(SUM(cs.monto_cierre), 0)::DECIMAL(14,2)                 AS saldo_sistema,
  COALESCE(SUM(cs.monto_real_cierre), 0)::DECIMAL(14,2)            AS conteo_real,
  COALESCE(SUM(cs.diferencia_cierre), 0)::DECIMAL(14,2)            AS diferencia_total,
  COALESCE(SUM(ABS(cs.diferencia_cierre)), 0)::DECIMAL(14,2)       AS diferencia_absoluta
FROM caja_sesiones cs
LEFT JOIN sucursales s ON s.id = cs.sucursal_id
LEFT JOIN cajas c       ON c.id = cs.caja_id
WHERE NOT COALESCE(c.es_caja_fuerte, FALSE)
GROUP BY cs.tenant_id, DATE(cs.abierta_at), cs.sucursal_id, s.nombre, cs.caja_id, c.nombre, c.moneda;

COMMENT ON VIEW vw_caja_resumen_diario IS 'Resumen diario por caja y sucursal. Excluye caja fuerte. Usado por reportes I1 (a) y (b).';

-- ============================================================
-- Vista vw_caja_mensual_por_sucursal — agregado por mes/sucursal
-- ============================================================
CREATE OR REPLACE VIEW vw_caja_mensual_por_sucursal
WITH (security_invoker = true)
AS
SELECT
  cs.tenant_id,
  DATE_TRUNC('month', cs.abierta_at)::DATE AS periodo,
  cs.sucursal_id,
  s.nombre                                  AS sucursal_nombre,
  COUNT(*)::INT                             AS sesiones_count,
  COUNT(*) FILTER (WHERE cs.estado = 'cerrada')::INT AS sesiones_cerradas,
  COALESCE(SUM(cs.total_ingresos), 0)::DECIMAL(14,2)        AS total_ingresos,
  COALESCE(SUM(cs.total_egresos), 0)::DECIMAL(14,2)         AS total_egresos,
  COALESCE(SUM(cs.total_ventas), 0)::DECIMAL(14,2)          AS total_ventas,
  COALESCE(SUM(cs.diferencia_cierre), 0)::DECIMAL(14,2)     AS diferencia_total,
  COALESCE(SUM(ABS(cs.diferencia_cierre)), 0)::DECIMAL(14,2) AS diferencia_absoluta,
  COUNT(DISTINCT cs.caja_id)::INT          AS cajas_activas,
  COUNT(DISTINCT cs.usuario_id)::INT       AS cajeros_distintos
FROM caja_sesiones cs
LEFT JOIN sucursales s ON s.id = cs.sucursal_id
LEFT JOIN cajas c       ON c.id = cs.caja_id
WHERE NOT COALESCE(c.es_caja_fuerte, FALSE)
GROUP BY cs.tenant_id, DATE_TRUNC('month', cs.abierta_at), cs.sucursal_id, s.nombre;

COMMENT ON VIEW vw_caja_mensual_por_sucursal IS 'Resumen mensual por sucursal alineado con cierre contable. Usado por reporte I1 (c).';
