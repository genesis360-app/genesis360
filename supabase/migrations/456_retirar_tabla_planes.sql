-- 456 — Retirar la tabla `planes` (legacy) y `tenants.plan_id`
--
-- Pedido de GO (2026-10-02): "lo que veo en la tabla planes de PRD no coincide con la página de planes ni con la
-- landing". La tabla es de la primera versión (marzo 2026: Básico $0 / Estándar $1.500 / Avanzado $3.000) y quedó sin
-- uso: los planes y precios vigentes viven en código (`src/config/brand.ts` → PLANES, PLAN_BASE_LIMITS, ADDON_PACKS) y
-- los límites en `fn_plan_base_limite`; el plan de cada negocio es `tenants.plan_tier`. El panel interno la usaba para
-- el MRR hasta el 2026-10-01 (corregido con `_shared/precios.ts`).
--
-- Al 2026-10-02 `tenants.plan_id` estaba cargado solo en 2 negocios de prueba de PROD (mrdfxsdf → "Básico",
-- Familia Otranto → "Estándar"), ambos con `plan_tier = 'basico'`, que es lo que manda. No se pierde información útil.
-- Antes de aplicar en PROD: desplegar `admin-api` sin `plan_id` en el select de `customers.get` (si no, esa consulta
-- falla al no existir la columna).

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_plan_id_fkey;
DROP INDEX IF EXISTS public.idx_tenants_plan_id;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS plan_id;
DROP TABLE IF EXISTS public.planes;
