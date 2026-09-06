-- 398 — `venta_items.sucursal_id` denormalizada: el arreglo REAL de E4-h2 (Tanda E)
--
-- ── Por qué esta migración existe y la 397 no alcanzó ────────────────────────────────────────
-- La 397 apostó a un índice de cobertura sobre `ventas` para que el subplan de la RLS de
-- `venta_items` se armara sin tocar el heap. **Se midió y NO funcionó**: 48 ms → 107 ms (peor).
-- El plan siguió haciendo Bitmap Heap Scan —un Bitmap Index Scan SIEMPRE va al heap para el
-- recheck— y, sobre todo, el costo real no era el acceso al índice sino el `Filter` evaluándose
-- fila por fila sobre las 558 ventas del tenant. Índice inútil con costo de escritura sobre una
-- tabla caliente → esta migración lo borra. Se deja el registro de la hipótesis descartada a
-- propósito: es lo que evita que alguien la vuelva a intentar.
--
-- ── El problema de fondo ─────────────────────────────────────────────────────────────────────
-- `venta_items` no tenía `sucursal_id`, así que su policy resolvía la sucursal con un EXISTS
-- contra `ventas`. Postgres lo convertía en un hashed SubPlan que **materializa TODAS las ventas
-- visibles del tenant antes de devolver la primera fila**. Medido: DUEÑO 2,1 ms (cortocircuita en
-- `auth_ve_todas_sucursales()` y nunca ejecuta el subplan) vs CAJERO 48,0 ms. O(ventas del tenant)
-- por query — a 100.000 ventas, cada listado de ítems escanea 100.000 filas.
--
-- ── El fix ───────────────────────────────────────────────────────────────────────────────────
-- Denormalizar `sucursal_id` en `venta_items` (la sucursal de una venta no cambia después de
-- crearse) → la policy compara una columna local: O(1) por fila.
--
-- 🛑 REGLA #0: una columna desincronizada ESCONDERÍA ítems de venta por RLS, que es peor que el
-- problema de performance. Por eso:
--   1) El backfill y el cambio de policy van en la MISMA transacción.
--   2) Trigger en `venta_items` (INSERT/UPDATE de venta_id) que la deriva siempre de `ventas`.
--   3) Trigger en `ventas` que propaga si alguna vez cambia la sucursal de una venta.
--   4) La policy conserva el EXISTS original como **fallback exacto** para filas con
--      `sucursal_id IS NULL`. Si un día el trigger fallara, el peor caso es volver al plan lento
--      —nunca esconder un ítem—. Tras el backfill esa rama queda "never executed".

BEGIN;

-- 1) Deshacer el intento fallido de la 397 (medido: empeoraba de 48 ms a 107 ms).
DROP INDEX IF EXISTS public.idx_ventas_tenant_sucursal_cover;

-- 2) La columna denormalizada.
ALTER TABLE public.venta_items ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursales(id);

COMMENT ON COLUMN public.venta_items.sucursal_id IS
  'Denormalizada de ventas.sucursal_id (mig 398) — SOLO para que la RLS por sucursal sea O(1). '
  'La mantiene el trigger trg_venta_items_sucursal; nunca escribirla a mano. NULL = venta global.';

-- 3) Backfill.
UPDATE public.venta_items vi
   SET sucursal_id = v.sucursal_id
  FROM public.ventas v
 WHERE v.id = vi.venta_id
   AND vi.sucursal_id IS DISTINCT FROM v.sucursal_id;

-- 4) Sincronía hacia adelante.
CREATE OR REPLACE FUNCTION public.fn_venta_items_set_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.venta_id IS NULL THEN
    NEW.sucursal_id := NULL;
  ELSE
    SELECT v.sucursal_id INTO NEW.sucursal_id FROM public.ventas v WHERE v.id = NEW.venta_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_venta_items_sucursal ON public.venta_items;
CREATE TRIGGER trg_venta_items_sucursal
  BEFORE INSERT OR UPDATE OF venta_id ON public.venta_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_venta_items_set_sucursal();

-- Defensivo: si alguna vez se moviera la sucursal de una venta, los ítems la siguen.
CREATE OR REPLACE FUNCTION public.fn_ventas_propagar_sucursal_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.venta_items SET sucursal_id = NEW.sucursal_id WHERE venta_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_ventas_propagar_sucursal_items ON public.ventas;
CREATE TRIGGER trg_ventas_propagar_sucursal_items
  AFTER UPDATE OF sucursal_id ON public.ventas
  FOR EACH ROW WHEN (OLD.sucursal_id IS DISTINCT FROM NEW.sucursal_id)
  EXECUTE FUNCTION public.fn_ventas_propagar_sucursal_items();

-- 5) La policy: mismo resultado, sin materializar `ventas`.
DROP POLICY IF EXISTS venta_items_tenant ON public.venta_items;

CREATE POLICY venta_items_tenant ON public.venta_items
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.auth_ve_todas_sucursales()
      OR venta_id IS NULL
      OR sucursal_id = public.auth_user_sucursal()
      -- Fallback EXACTO al comportamiento anterior para filas sin denormalizar (o de ventas
      -- globales). Tras el backfill esta rama queda "never executed".
      OR (sucursal_id IS NULL AND EXISTS (
            SELECT 1 FROM public.ventas v
             WHERE v.id = venta_items.venta_id
               AND (v.sucursal_id IS NULL OR v.sucursal_id = public.auth_user_sucursal())))
    )
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_venta_items_tenant_sucursal
  ON public.venta_items (tenant_id, sucursal_id);

COMMIT;
