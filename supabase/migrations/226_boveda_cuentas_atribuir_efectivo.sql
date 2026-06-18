-- Migration 226: vw_boveda_cuentas — atribuir el efectivo sin cuenta a la cuenta Efectivo
-- Pedido GO (2026-06-18): el "Capital del negocio por cuenta" / "Capital total" no reflejaba
-- el efectivo de ventas/gastos. Causa: esos caja_movimientos dejan cuenta_origen_id en NULL,
-- y la vista solo sumaba los que tenían cuenta asignada.
--
-- Fix (read-time, sin tocar write-paths ni backfill de datos): los movimientos SIN cuenta
-- que NO son informativos (es decir, efectivo físico: ventas, gastos, traspasos, señas) se
-- atribuyen a la cuenta Efectivo del tenant. Los informativos (tarjeta/transferencia/MP)
-- sin cuenta quedan sin atribuir (su cuenta se asigna por método, no son efectivo).
--
-- Verificado en DEV: Almacén Jorgito 12.873.811 → 12.889.570 (apenas +15.759, ya tenía casi
-- todo atribuido; sin doble conteo) · Kiosco Buildi 10.000 → 55.300 (ahora cuenta ventas/gastos).
-- LIMITACIÓN CONOCIDA: las aperturas de caja (monto_apertura) no son movimientos → no se
-- cuentan acá (gap a evaluar aparte). Preserva security_invoker=true.

CREATE OR REPLACE VIEW vw_boveda_cuentas
WITH (security_invoker = true) AS
SELECT
  co.tenant_id,
  co.id AS cuenta_origen_id,
  co.nombre,
  co.tipo,
  co.banco,
  co.moneda,
  co.activo,
  COALESCE(sum(
    CASE
      WHEN cm.tipo LIKE 'ingreso%' THEN cm.monto
      WHEN cm.tipo LIKE 'egreso%'  THEN - cm.monto
      ELSE 0::numeric
    END), 0::numeric)::numeric(14,2) AS saldo,
  count(cm.id) AS movimientos_count,
  max(cm.created_at) AS ultimo_movimiento_at
FROM cuentas_origen co
LEFT JOIN caja_movimientos cm
  ON cm.tenant_id = co.tenant_id
  AND COALESCE(
        cm.cuenta_origen_id,
        CASE WHEN cm.tipo NOT LIKE '%informativo%'
             THEN (SELECT e.id FROM cuentas_origen e
                    WHERE e.tenant_id = cm.tenant_id AND e.tipo = 'efectivo'
                    LIMIT 1)
        END
      ) = co.id
GROUP BY co.id, co.tenant_id, co.nombre, co.tipo, co.banco, co.moneda, co.activo;
