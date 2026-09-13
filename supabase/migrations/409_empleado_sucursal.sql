-- 409 — Un empleado pertenece a una sucursal
--
-- ── El problema ──────────────────────────────────────────────────────────────────────────────
-- Los 4 gastos que genera RRHH (sueldo, cargas sociales, adelanto/préstamo y liquidación final) se
-- creaban SIN `sucursal_id`. Como el módulo Gastos filtra por la sucursal activa, esos gastos
-- existían pero **no aparecían nunca**: el sueldo se liquidaba y la plata no se veía salir por
-- ningún lado. Es el mismo bug que ya había aparecido en Recursos y en servicios de Proveedores.
--
-- No se podía arreglar solo del lado del gasto: `empleados` no tenía sucursal, así que imputar el
-- sueldo a la sucursal de QUIEN LIQUIDA habría sido inventar un criterio contable (el gasto del
-- empleado de la sucursal Sur cargado a Centro porque lo liquidó alguien de Centro).
--
-- ── La decisión ──────────────────────────────────────────────────────────────────────────────
-- GO eligió la opción (a) el 2026-09-12: **que un empleado pertenezca a una sucursal**. La
-- alternativa (b) era que los gastos sin sucursal se vieran siempre, pero eso cambiaba el
-- comportamiento de TODOS los gastos globales, no solo los de RRHH.
--
-- ── Por qué NULLABLE ─────────────────────────────────────────────────────────────────────────
-- Hay empleados cargados desde antes y no hay forma de adivinar a qué sucursal van cuando el
-- negocio tiene varias. Un NOT NULL exigiría inventar ese dato o romper el alta. Se deja nullable:
-- el empleado sin sucursal genera un gasto global, exactamente como hasta hoy.
--
-- ── Qué NO hace esta migración ───────────────────────────────────────────────────────────────
-- 1. **No agrega RLS por sucursal sobre `empleados`.** RRHH se administra de forma central y hoy
--    cualquier usuario habilitado ve toda la nómina; restringirlo sería otro cambio, con su propia
--    decisión de negocio. Esta columna es para IMPUTAR el gasto, no para esconder al empleado.
-- 2. **No toca los gastos ya creados.** Reescribir la sucursal de un gasto histórico es reescribir
--    un registro contable pasado: si hasta ayer ese sueldo era un gasto global del negocio, que lo
--    siga siendo. De acá en adelante se imputa bien.

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursales(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.empleados.sucursal_id IS
  'Sucursal a la que pertenece el empleado. Gobierna a qué sucursal se imputan los gastos que '
  'genera RRHH (sueldo, cargas sociales, adelantos, liquidación final). NULL = gasto global.';

CREATE INDEX IF NOT EXISTS idx_empleados_sucursal ON public.empleados(tenant_id, sucursal_id);

-- ── Backfill seguro ──────────────────────────────────────────────────────────────────────────
-- Solo donde NO hay ambigüedad: un negocio con UNA sola sucursal activa. Ahí la respuesta es
-- única y dejar el campo vacío obligaría a que cada tenant chico edite empleado por empleado para
-- que sus sueldos dejen de ser invisibles. Con 2 o más sucursales no se toca nada: lo elige quien
-- conoce el negocio.
UPDATE public.empleados e
SET sucursal_id = u.unica
FROM (
  -- `array_agg(...)[1]` y no `MIN(id)`: en Postgres no hay `min(uuid)`. El `HAVING` garantiza que
  -- el grupo tiene exactamente una fila, así que el elemento 1 ES la única sucursal.
  SELECT tenant_id, (array_agg(id))[1] AS unica
  FROM public.sucursales
  WHERE activo = true
  GROUP BY tenant_id
  HAVING COUNT(*) = 1
) u
WHERE e.tenant_id = u.tenant_id
  AND e.sucursal_id IS NULL;
