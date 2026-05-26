-- Migration 138: Auto-seed de Cuentas de Origen por método de pago + backfill conceptos
-- Reglas de negocio Caja · Tanda 1.5 (v1.9.2)
--
-- Para que el DUEÑO vea TODO su capital histórico discriminado por método de pago,
-- crea una cuenta_origen por cada método de pago activo (que no sea "Efectivo")
-- y vincula el método con esa cuenta.
-- Luego re-aplica el backfill a movimientos informativos históricos cuyo concepto
-- empieza con [Nombre del Método].

-- ============================================================
-- 1) Crear cuenta de origen para cada método de pago no-efectivo activo
-- ============================================================
INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
SELECT DISTINCT
  mp.tenant_id,
  mp.nombre AS nombre,
  CASE
    WHEN mp.nombre ILIKE '%mercado%pago%' OR mp.nombre ILIKE '%mp%'
      OR mp.nombre ILIKE '%ual%' OR mp.nombre ILIKE '%naranja x%'
      OR mp.nombre ILIKE '%personal pay%' OR mp.nombre ILIKE '%billetera%'
      THEN 'billetera'
    WHEN mp.nombre ILIKE '%transferencia%' OR mp.nombre ILIKE '%débito%'
      OR mp.nombre ILIKE '%debito%' OR mp.nombre ILIKE '%crédito%'
      OR mp.nombre ILIKE '%credito%' OR mp.nombre ILIKE '%tarjeta%'
      THEN 'banco'
    ELSE 'otro'
  END AS tipo,
  COALESCE(t.moneda, 'ARS') AS moneda,
  TRUE
FROM metodos_pago mp
JOIN tenants t ON t.id = mp.tenant_id
WHERE mp.activo = TRUE
  AND mp.cuenta_origen_id IS NULL
  AND LOWER(mp.nombre) <> 'efectivo'
  AND NOT EXISTS (
    SELECT 1 FROM cuentas_origen co
    WHERE co.tenant_id = mp.tenant_id AND co.nombre = mp.nombre
  );

-- ============================================================
-- 2) Vincular cada método con la cuenta recién creada
-- ============================================================
UPDATE metodos_pago mp
SET cuenta_origen_id = co.id
FROM cuentas_origen co
WHERE mp.tenant_id = co.tenant_id
  AND mp.cuenta_origen_id IS NULL
  AND mp.nombre = co.nombre
  AND mp.activo = TRUE;

-- ============================================================
-- 3) Re-aplicar backfill a movimientos informativos históricos
-- ============================================================
UPDATE caja_movimientos cm
SET cuenta_origen_id = mp.cuenta_origen_id
FROM metodos_pago mp
WHERE cm.cuenta_origen_id IS NULL
  AND cm.tipo IN ('ingreso_informativo','egreso_informativo')
  AND cm.tenant_id = mp.tenant_id
  AND mp.cuenta_origen_id IS NOT NULL
  AND cm.concepto ~* ('^\[' || regexp_replace(mp.nombre, '([.()\[\]\\*+?^$|])', '\\\1', 'g') || '\]');
