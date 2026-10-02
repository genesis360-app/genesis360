-- 457 — Pricing v7: límites nuevos + herencia de los negocios existentes + prueba de 15 días
--
-- Fuente: docs de Fede "05 - Genesis360 Pricing y Costos v7" y "06 - Cambios de Pricing v6 a v7" (Drive).
-- Decisiones de GO (2026-10-02):
--   · Los negocios que existen al aplicar esta migración CONSERVAN los límites y módulos de su plan v6 ("los que
--     ingresaron antes del cambio mantienen lo que tienen; en los nuevos aplica el cambio"). Los que están en prueba
--     (vigente o vencida) heredan lo que la prueba les da hoy: Pro v6.
--   · Prueba de 15 días solo para las altas nuevas (las pruebas en curso conservan su fecha).
--   · Al vencer la prueba sin plan, se sigue mostrando /suscripcion (sin cambios acá).
--
-- Qué hace:
--   1. `tenant_herencia_plan`: foto, por negocio existente, del plan v6 heredado, sus límites y sus módulos. Se toma
--      ANTES de cambiar `fn_plan_base_limite` (los límites salen de la versión v6 todavía vigente).
--   2. `fn_plan_base_limite` → v7:   usuarios · productos · comprobantes/mes · sucursales · CUITs
--        Básico       3 ·  2.000 ·  5.000 · 1 · 1
--        Pro          7 ·  7.000 · 13.000 · 2 · 2
--        Enterprise  20 · 18.000 · 30.000 · 4 · 4   (deja de ser ilimitado)
--      'free' queda igual (legacy: solo lo usan negocios viejos con la prueba vencida).
--   3. `fn_tenant_limite`: límite = mayor(base v7 del plan, base heredada) + add-ons. Un negocio existente nunca baja;
--      los add-ons que ya compró se siguen sumando.
--   4. `tenants.trial_ends_at` por defecto = 15 días (altas nuevas).

-- 1) Herencia ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_herencia_plan (
  tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  tier_heredado text NOT NULL CHECK (tier_heredado IN ('free', 'basico', 'pro', 'enterprise')),
  limites       jsonb NOT NULL,          -- {"usuarios":15,"sku":8000,...}; -1 = ilimitado
  features      text[] NOT NULL,         -- módulos del plan v6 (mismos nombres que FEATURES_POR_PLAN)
  creado_at     timestamptz NOT NULL DEFAULT now(),
  nota          text
);

COMMENT ON TABLE public.tenant_herencia_plan IS
  'Pricing v7 (mig 457): límites y módulos del plan v6 que conservan los negocios existentes al cambio. Solo lectura.';

ALTER TABLE public.tenant_herencia_plan ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_herencia_plan'
                   AND policyname = 'tenant_herencia_plan_select_propio') THEN
    CREATE POLICY tenant_herencia_plan_select_propio ON public.tenant_herencia_plan
      FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
  END IF;
END $$;
REVOKE ALL ON public.tenant_herencia_plan FROM anon, authenticated;
GRANT SELECT ON public.tenant_herencia_plan TO authenticated;

INSERT INTO public.tenant_herencia_plan (tenant_id, tier_heredado, limites, features, nota)
SELECT t.id, h.tier,
       jsonb_build_object(
         'usuarios',     public.fn_plan_base_limite(h.tier, 'usuarios'),
         'sku',          public.fn_plan_base_limite(h.tier, 'sku'),
         'comprobantes', public.fn_plan_base_limite(h.tier, 'comprobantes'),
         'sucursales',   public.fn_plan_base_limite(h.tier, 'sucursales'),
         'cuits',        public.fn_plan_base_limite(h.tier, 'cuits'),
         'movimientos',  -1),
       CASE h.tier
         WHEN 'free'   THEN ARRAY['ventas','caja','gastos','clientes','inventario','movimientos','alertas']
         WHEN 'basico' THEN ARRAY['ventas','caja','gastos','clientes','inventario','movimientos','alertas','reportes','historial','metricas']
         ELSE               ARRAY['ventas','caja','gastos','clientes','inventario','movimientos','alertas','reportes','historial','metricas','importar','rrhh','aging','marketplace','wms']
       END,
       format('Pricing v7 (mig 457): plan %s, estado %s → hereda %s v6', t.plan_tier, t.subscription_status, h.tier)
  FROM public.tenants t
  CROSS JOIN LATERAL (SELECT CASE WHEN t.subscription_status = 'trial' THEN 'pro' ELSE t.plan_tier END AS tier) h
ON CONFLICT (tenant_id) DO NOTHING;

-- 2) Límites base v7 ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_plan_base_limite(p_tier text, p_dim text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_tier
    WHEN 'enterprise' THEN CASE p_dim
      WHEN 'sku' THEN 18000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 30000
      WHEN 'sucursales' THEN 4 WHEN 'usuarios' THEN 20 WHEN 'cuits' THEN 4 ELSE 0 END
    WHEN 'pro' THEN CASE p_dim
      WHEN 'sku' THEN 7000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 13000
      WHEN 'sucursales' THEN 2 WHEN 'usuarios' THEN 7 WHEN 'cuits' THEN 2 ELSE 0 END
    WHEN 'basico' THEN CASE p_dim
      WHEN 'sku' THEN 2000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 5000
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 3 WHEN 'cuits' THEN 1 ELSE 0 END
    ELSE CASE p_dim  -- free (legacy)
      WHEN 'sku' THEN 50 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 200
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 1 WHEN 'cuits' THEN 1 ELSE 0 END
  END
$function$;

-- 3) Límite efectivo con herencia ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tenant_limite(p_tenant_id uuid, p_dim text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier TEXT; v_status TEXT; v_trial TIMESTAMPTZ; v_base INT; v_addons INT; v_her INT;
BEGIN
  SELECT plan_tier, subscription_status, trial_ends_at
    INTO v_tier, v_status, v_trial
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_tier IS NULL THEN RETURN 0; END IF;
  IF v_status = 'trial' AND v_trial IS NOT NULL AND v_trial >= now() THEN
    v_tier := 'pro';
  END IF;
  v_base := public.fn_plan_base_limite(v_tier, p_dim);
  -- Pricing v7 (mig 457): un negocio existente conserva la base de su plan v6 si es mayor.
  SELECT (limites ->> p_dim)::int INTO v_her FROM public.tenant_herencia_plan WHERE tenant_id = p_tenant_id;
  IF v_base = -1 OR v_her = -1 THEN RETURN -1; END IF;
  v_base := GREATEST(v_base, COALESCE(v_her, 0));
  SELECT COALESCE(SUM(cantidad), 0) INTO v_addons
    FROM public.tenant_addons
    WHERE tenant_id = p_tenant_id AND dimension = p_dim
      AND (tipo = 'fijo' OR (tipo = 'temporal' AND vence_at > now()));
  RETURN v_base + v_addons;
END $function$;

-- 4) Prueba de 15 días para las altas nuevas ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ALTER COLUMN trial_ends_at SET DEFAULT (now() + '15 days'::interval);
