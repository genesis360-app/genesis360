-- Migration 139: backfill flexible cuenta_origen_id (tolerancia a variantes de nombre)
-- v1.9.3
--
-- Bug: conceptos históricos usan "[Tarjeta crédito]" pero el método se llama
-- "Tarjeta de crédito". El backfill exacto de migration 138 no encuentra match.
--
-- Fix: normalizar ambos lados (lowercase + sin tildes + sin " de ") antes de comparar.

WITH conceptos_norm AS (
  SELECT
    cm.id AS movimiento_id,
    cm.tenant_id,
    regexp_replace(
      regexp_replace(
        translate(lower(substring(cm.concepto FROM '^\[([^\]]+)\]')), 'áéíóúñ', 'aeioun'),
        '\sde\s', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ) AS nombre_norm
  FROM caja_movimientos cm
  WHERE cm.cuenta_origen_id IS NULL
    AND cm.tipo IN ('ingreso_informativo','egreso_informativo')
    AND cm.concepto ~ '^\['
    AND cm.concepto NOT LIKE '%+%'   -- excluir conceptos multi-medio (no asignables a una sola cuenta)
),
metodos_norm AS (
  SELECT
    mp.tenant_id,
    mp.cuenta_origen_id,
    regexp_replace(
      regexp_replace(
        translate(lower(mp.nombre), 'áéíóúñ', 'aeioun'),
        '\sde\s', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ) AS nombre_norm
  FROM metodos_pago mp
  WHERE mp.activo = TRUE
    AND mp.cuenta_origen_id IS NOT NULL
)
UPDATE caja_movimientos cm
SET cuenta_origen_id = mn.cuenta_origen_id
FROM conceptos_norm cn
JOIN metodos_norm mn ON mn.tenant_id = cn.tenant_id AND mn.nombre_norm = cn.nombre_norm
WHERE cm.id = cn.movimiento_id;
