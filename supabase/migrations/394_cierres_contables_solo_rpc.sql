-- 394 — Cierres contables: escritura SOLO por RPC (Tanda F, hallazgo F1-h1)
--
-- 🟥🟥 HALLAZGO (REGLA #0, verificado con sondas REST reales el 2026-09-06 contra DEV):
-- `cerrar_periodo()` valida el rol server-side ("Tu rol (CAJERO) no puede cerrar periodos
-- contables") — pero la policy de la tabla era `FOR ALL ... tenant_id IN (...)` a secas, sin
-- mirar el rol. O sea: un CAJERO/DEPOSITO/RRHH con su token real podía **saltear el RPC** y
-- hacer `POST /rest/v1/cierres_contables` directo, congelando un mes contable entero (los
-- triggers de período cerrado bloquean después toda edición de gastos/ventas de ese mes).
-- El guard existía y se esquivaba escribiendo la tabla. Sonda confirmada en los 4 roles.
--
-- FIX: la tabla pasa a ser **solo lectura** para cualquier usuario autenticado. El ÚNICO
-- camino de escritura son `cerrar_periodo()` / `reabrir_periodo()`, que son SECURITY DEFINER
-- (bypassean RLS) y ya validan rol, orden de períodos y que solo se reabra el último.
--
-- Riesgo verificado ANTES de aplicar (por qué esto no rompe nada):
--   • El frontend NUNCA escribe la tabla: `CierresContablesPanel.tsx` y `useCierreContable.ts`
--     solo hacen SELECT; cerrar/reabrir van por RPC.
--   • Ninguna Edge Function toca `cierres_contables` (grep sobre supabase/functions).
--   • service_role no pasa por RLS → jobs/backoffice intactos.
-- No se toca la lectura: sigue siendo todo el tenant, como antes.

BEGIN;

DROP POLICY IF EXISTS cierres_tenant ON public.cierres_contables;

-- Lectura: igual que antes (cualquier usuario del tenant).
CREATE POLICY cierres_select_tenant ON public.cierres_contables
  FOR SELECT
  USING (
    tenant_id IN (SELECT users.tenant_id FROM public.users WHERE users.id = (SELECT auth.uid()))
  );

-- Escritura directa: NINGUNA. Sin policy de INSERT/UPDATE/DELETE, RLS las rechaza.
-- (Deliberado: ni el DUEÑO escribe esta tabla a mano — el orden de períodos y los totales
-- congelados los calcula `cerrar_periodo()`. Escribirla a mano falsearía el cierre.)

COMMIT;

COMMENT ON TABLE public.cierres_contables IS
  'Cierres contables mensuales. SOLO LECTURA vía RLS (mig 394): se escribe únicamente por los '
  'RPC cerrar_periodo()/reabrir_periodo() (SECURITY DEFINER, validan rol y orden de períodos). '
  'Antes se podía insertar por REST directo con cualquier rol, salteando el guard — Tanda F, F1-h1.';
