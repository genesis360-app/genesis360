-- Migration 393: fix de `vw_consumo_mensual` — `costo_facturable` devolvía NULL en vez de 0.
--
-- Detectado en la verificación end-to-end del 2026-09-06: cuando NINGÚN evento de un grupo es
-- facturable (el caso normal hoy, porque Meta marca los mensajes dentro de la ventana de 24 h como
-- `billable: false`), `SUM(costo) FILTER (WHERE facturable)` no tiene filas que sumar y Postgres
-- devuelve NULL, no 0.
--
-- La UI actual lo tolera (normaliza con Number()), pero es una bomba para cualquier consumidor futuro
-- que haga aritmética sobre una columna de plata: NULL + cualquier cosa = NULL, y una factura o un
-- reporte saldría vacío en vez de en cero. Se envuelve en COALESCE, que es lo correcto para una
-- columna monetaria: "no hubo consumo facturable" es CERO, no "desconocido".
--
-- Solo cambia la vista; el ledger (`consumo_eventos`) no se toca y no hay datos que migrar.

CREATE OR REPLACE VIEW vw_consumo_mensual
WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  date_trunc('month', e.ocurrido_at)::date            AS periodo,
  e.canal,
  e.concepto,
  e.moneda,
  COUNT(*)                                            AS eventos,
  COALESCE(SUM(e.cantidad), 0)                        AS cantidad,
  COALESCE(SUM(e.costo) FILTER (WHERE e.facturable), 0) AS costo_facturable,
  COALESCE(SUM(e.costo), 0)                           AS costo_total,
  COUNT(*) FILTER (WHERE NOT e.tarifa_encontrada)     AS eventos_sin_tarifa
FROM consumo_eventos e
GROUP BY e.tenant_id, date_trunc('month', e.ocurrido_at), e.canal, e.concepto, e.moneda;

REVOKE ALL ON vw_consumo_mensual FROM anon;
GRANT SELECT ON vw_consumo_mensual TO authenticated;
