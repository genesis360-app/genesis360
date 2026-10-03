-- 461 — Cada pack fijo guarda el precio con el que se contrató (REGLA #0, plata; decisión PR-6 de GO 2026-10-02)
--
-- Problema: `mp-addon-batch` recalcula el recurrente nuevo como
--   montoActualMP − precio(packs actuales) + precio(packs objetivo)
-- tomando el precio de los packs ACTUALES del catálogo de HOY. Con pricing v7 el pack de sucursales cambia
-- (v6 $15k/$35k/$55k → v7 $35k/$55k/$70k): quien compró +1 sucursal a $15.000 y quita el pack quedaría con
-- un descuento de $35.000 sobre su recurrente (o, si lo mantiene y cambia otra dimensión, se le cobraría el
-- precio nuevo). PR-6: el precio nuevo de un add-on aplica SOLO a compras nuevas.
--
-- Arreglo: `tenant_addons.precio_mensual` = precio con que se sumó al recurrente. Lo escribe
-- `fn_aplicar_addon_batch` desde `addon_batch_changes.packs_objetivo` (cada pack ahora trae `precio`, que la EF
-- calcula: pack que no cambia → conserva su precio; pack nuevo o distinto → precio del catálogo vigente).
-- Backfill: los packs fijos existentes se contrataron con el catálogo v6 (v7 todavía no está en PROD al 02/10).
-- Al 02/10 en PROD hay 1 pack fijo (usuarios +1, negocio de prueba, mismo precio en v6 y v7).

ALTER TABLE public.tenant_addons ADD COLUMN IF NOT EXISTS precio_mensual numeric(14,2);

COMMENT ON COLUMN public.tenant_addons.precio_mensual IS
  'Mig 461: precio mensual con el que el pack FIJO se sumó al recurrente de MP (el catálogo puede cambiar después; PR-6). NULL en temporales.';

UPDATE public.tenant_addons a
   SET precio_mensual = v6.precio
  FROM (VALUES
    ('sku', 500, 5000), ('sku', 2000, 10000), ('sku', 8000, 25000),
    ('sucursales', 1, 15000), ('sucursales', 3, 35000), ('sucursales', 5, 55000),
    ('usuarios', 1, 5000), ('usuarios', 3, 10000), ('usuarios', 5, 15000),
    ('comprobantes', 1000, 10000), ('comprobantes', 5000, 30000), ('comprobantes', 10000, 50000),
    ('cuits', 1, 20000), ('cuits', 2, 35000), ('cuits', 3, 45000)
  ) AS v6(dimension, cantidad, precio)
 WHERE a.tipo = 'fijo' AND a.precio_mensual IS NULL
   AND a.dimension = v6.dimension AND a.cantidad = v6.cantidad;

CREATE OR REPLACE FUNCTION public.fn_aplicar_addon_batch(p_tenant_id uuid, p_change_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estado TEXT;
  v_packs JSONB;
  v_plan TEXT;
BEGIN
  SELECT estado, packs_objetivo, plan_objetivo INTO v_estado, v_packs, v_plan
    FROM public.addon_batch_changes
    WHERE id = p_change_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF v_estado IS NULL THEN RETURN FALSE; END IF;          -- no existe / de otro tenant
  IF v_estado = 'aplicado' THEN RETURN TRUE; END IF;      -- idempotente
  IF v_estado NOT IN ('pendiente_pago','esperando_cobro') THEN RETURN FALSE; END IF;

  DELETE FROM public.tenant_addons WHERE tenant_id = p_tenant_id AND tipo = 'fijo';
  -- Mig 461: el precio viaja en packs_objetivo (lo calcula la EF). Un change creado antes de la 461 no lo trae →
  -- NULL, y la EF cae al catálogo para ese pack (mismo comportamiento que antes).
  INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo, vence_at, precio_mensual)
  SELECT p_tenant_id, x.dimension, x.cantidad, 'fijo', NULL, x.precio
  FROM jsonb_to_recordset(v_packs) AS x(dimension TEXT, cantidad INT, precio NUMERIC)
  WHERE x.cantidad > 0;

  IF v_plan IS NOT NULL THEN
    UPDATE public.tenants SET
      plan_tier     = v_plan,
      max_users     = CASE v_plan WHEN 'pro' THEN 15   ELSE 5    END,
      max_productos = CASE v_plan WHEN 'pro' THEN 8000 ELSE 2000 END
    WHERE id = p_tenant_id;
  END IF;

  UPDATE public.addon_batch_changes
    SET estado = 'aplicado', applied_at = now()
    WHERE id = p_change_id;
  RETURN TRUE;
END $function$;
