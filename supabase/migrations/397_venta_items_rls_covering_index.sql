-- 397 — `venta_items`: bajar el costo de la RLS por sucursal (Tanda E, hallazgo E4-h2)
--
-- HALLAZGO (medido, no supuesto). `venta_items` no tiene `sucursal_id`, así que su policy resuelve
-- la sucursal con un EXISTS contra `ventas`:
--
--   EXISTS (SELECT 1 FROM ventas v
--            WHERE v.id = venta_items.venta_id
--              AND (v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal()))
--
-- Postgres lo convierte en un **hashed SubPlan** que materializa TODAS las ventas visibles del
-- tenant antes de devolver la primera fila. `EXPLAIN ANALYZE` del mismo query (`select … from
-- venta_items limit 50`), en DEV:
--
--   como DUEÑO   →  2,1 ms  (SubPlan "never executed": cortocircuita en auth_ve_todas_sucursales())
--   como CAJERO  → 48,0 ms  (Bitmap Heap Scan on ventas: rows=558, Buffers: shared hit=1137)
--
-- 24× de castigo para el rol restringido, y escala O(ventas del tenant) POR QUERY. Es el causante
-- del p95 de 1,4 s con 20 sesiones concurrentes en `npm run stress:lectura`.
--
-- ⚠ Medirlo con el DUEÑO da 2 ms y parece sano: cualquier prueba de performance sobre RLS hay que
-- hacerla con el rol restringido.
--
-- FIX (aditivo, sin riesgo): índice de cobertura para que el subplan se arme leyendo SOLO el índice
-- (Index Only Scan) en vez de ir al heap. `INCLUDE (id)` mete la columna que el subplan proyecta.
-- No cambia la policy ni el resultado: exactamente las mismas filas, menos páginas leídas.
--
-- Lo que este fix NO hace: sigue siendo O(ventas del tenant). El arreglo estructural es denormalizar
-- `sucursal_id` en `venta_items` (O(1) por fila), pero eso es backfill + trigger de sincronía sobre
-- una tabla FISCAL, y una columna desincronizada escondería ítems de venta por RLS. Queda anotado en
-- la Tanda E como decisión aparte, con su propia batería de pruebas.

CREATE INDEX IF NOT EXISTS idx_ventas_tenant_sucursal_cover
  ON public.ventas (tenant_id, sucursal_id) INCLUDE (id);

COMMENT ON INDEX public.idx_ventas_tenant_sucursal_cover IS
  'Cobertura para el subplan de la RLS de venta_items (mig 397, Tanda E · E4-h2): permite armar el '
  'set de ventas visibles sin tocar el heap. Medir siempre con un rol restringido por sucursal.';
