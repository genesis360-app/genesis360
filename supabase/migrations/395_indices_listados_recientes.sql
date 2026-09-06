-- 395 — Índices para los listados "últimos N" (Tanda E, hallazgo E4)
--
-- HALLAZGO (medido, no supuesto — `EXPLAIN ANALYZE` real en DEV el 2026-09-06):
--
--   explain analyze select id, numero, total, monto_pagado, created_at
--                     from ventas order by created_at desc limit 20;
--
--   Limit (rows=20)
--     -> Sort (Sort Key: created_at DESC, top-N heapsort)
--          -> Index Scan using idx_ventas_tenant on ventas (rows=662)   ← lee TODAS
--               Index Cond: (tenant_id = get_user_tenant_id())
--               Filter: (auth_ve_todas_sucursales() OR sucursal_id ...)
--   Execution Time: 17 ms
--
-- Para devolver 20 filas lee las **662 ventas del tenant** y recién ahí ordena: el `LIMIT` no
-- puede cortar antes porque el orden se resuelve después del filtro. Es O(n) sobre el historial
-- completo. Hoy son 17 ms porque el tenant de prueba tiene 821 ventas en total — escala de demo.
-- Un comercio real hace eso en dos semanas; con 100.000 ventas el mismo dashboard escanea 100.000
-- filas en CADA carga. `ventas` tenía 13 índices y ninguno servía para este orden.
--
-- La sonda de carga (`scripts/stress-lectura.mjs`, 5 sesiones concurrentes) lo mostró de punta a
-- punta: `ventas` p50 277 ms vs 69-97 ms del resto de los listados.
--
-- FIX: índices compuestos (tenant_id, created_at DESC). Con el orden ya materializado en el
-- índice, el plan camina el índice y corta a las 20 filas → O(20) en vez de O(n).
-- 14 lugares del frontend ordenan `ventas` por `created_at` (Historial, Clientes, Facturación,
-- Reportes, Envíos, Alertas, Métricas…), así que el índice le sirve a todos.
--
-- Aditivo puro: no cambia datos ni comportamiento, solo el plan. Sin CONCURRENTLY a propósito —
-- las tablas son chicas en DEV y PROD (no hay clientes reales todavía) y `apply_migration` corre
-- en transacción. Si alguna vez se aplica sobre una tabla con volumen real, usar CONCURRENTLY
-- fuera de transacción.

CREATE INDEX IF NOT EXISTS idx_ventas_tenant_created
  ON public.ventas (tenant_id, created_at DESC);

-- Mismo patrón: el listado de Movimientos ordena por fecha descendente dentro del tenant.
-- Hoy usa `idx_movimientos_fecha` (created_at solo) y filtra el tenant fila por fila — funciona
-- con 10 tenants, se degrada a medida que entren clientes.
CREATE INDEX IF NOT EXISTS idx_movimientos_tenant_created
  ON public.movimientos_stock (tenant_id, created_at DESC);

COMMENT ON INDEX public.idx_ventas_tenant_created IS
  'Listados "últimas N ventas" (14 usos en el frontend). Mig 395 — sin esto el LIMIT no corta y '
  'se escanea el historial completo del tenant en cada carga. Ver Tanda E, E4.';
