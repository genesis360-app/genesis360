-- Migration 251 — Pricing 2026 · FASE 0: modelo de datos + límite efectivo (sin enforcement).
-- Ver plan de fases en G360.Wiki/wiki/business/planes-pricing.md.
-- Aditiva. NO bloquea nada todavía (el enforcement es la mig 252). Los límites base nuevos
-- son >= a los viejos → ningún tenant existente queda sobre-límite.
--
-- Decisiones (GO 2026-07-01):
--   • plan_tier explícito (desacopla el tier de max_users — con add-ons de usuarios,
--     max_users dejaba de ser confiable: Básico 5 + addon 5 = 10 se leía como Pro).
--   • tenant_addons: ledger de add-ons por dimensión (sku/movimientos/sucursales/usuarios),
--     fijos (recurrentes) o temporales (vencen a 30d). Los crea el webhook/EF de MP (service_role).
--   • Límite efectivo = base(plan_tier) + Σ add-ons activos. Trial activo → límites de 'pro'.

-- 1) plan_tier explícito + backfill desde la inferencia actual (max_users)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free','basico','pro','enterprise'));

UPDATE public.tenants SET plan_tier = CASE
  WHEN max_users = -1 OR max_users >= 100 THEN 'enterprise'
  WHEN max_users >= 10 THEN 'pro'
  WHEN max_users >= 2  THEN 'basico'
  ELSE 'free'
END;

COMMENT ON COLUMN public.tenants.plan_tier IS 'Tier del plan (fuente de verdad, desacoplado de max_users). Base de límites vía fn_plan_base_limite (mig 251).';

-- 2) Ledger de add-ons
CREATE TABLE IF NOT EXISTS public.tenant_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dimension     TEXT NOT NULL CHECK (dimension IN ('sku','movimientos','sucursales','usuarios')),
  cantidad      INT  NOT NULL CHECK (cantidad > 0),
  tipo          TEXT NOT NULL CHECK (tipo IN ('fijo','temporal')),
  vence_at      TIMESTAMPTZ,          -- NULL para 'fijo'; fecha (pago + 30d) para 'temporal'
  mp_payment_id TEXT,                 -- pago MP que originó el add-on (trazabilidad)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (tipo = 'fijo' OR vence_at IS NOT NULL)  -- temporal siempre con vencimiento
);
ALTER TABLE public.tenant_addons ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tenant_addons_tenant ON public.tenant_addons(tenant_id, dimension);

-- RLS: el tenant VE sus add-ons; la escritura es solo service_role (los crea el flujo de pago MP).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_addons' AND policyname='tenant_addons_select') THEN
    CREATE POLICY tenant_addons_select ON public.tenant_addons FOR SELECT
      USING (tenant_id = public.get_user_tenant_id() OR public.is_admin());
  END IF;
END $$;
-- Least-privilege (Supabase default-privileges dan acceso a anon/PUBLIC → revocar explícito)
REVOKE ALL ON public.tenant_addons FROM PUBLIC;
REVOKE ALL ON public.tenant_addons FROM anon;
GRANT SELECT ON public.tenant_addons TO authenticated;
GRANT ALL   ON public.tenant_addons TO service_role;

-- 3) Base de límites por tier (espejo de PLAN_BASE_LIMITS en src/config/brand.ts — mantener en sync).
--    -1 = ilimitado.
CREATE OR REPLACE FUNCTION public.fn_plan_base_limite(p_tier TEXT, p_dim TEXT)
RETURNS INT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE p_tier
    WHEN 'enterprise' THEN -1
    WHEN 'pro' THEN CASE p_dim
      WHEN 'sku' THEN 8000 WHEN 'movimientos' THEN 20000 WHEN 'sucursales' THEN 4 WHEN 'usuarios' THEN 15 ELSE 0 END
    WHEN 'basico' THEN CASE p_dim
      WHEN 'sku' THEN 2000 WHEN 'movimientos' THEN 5000 WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 5 ELSE 0 END
    ELSE CASE p_dim  -- free
      WHEN 'sku' THEN 50 WHEN 'movimientos' THEN 200 WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 1 ELSE 0 END
  END
$$;

-- 4) Límite EFECTIVO del tenant = base(tier) + Σ add-ons activos. Trial activo → tier 'pro'.
CREATE OR REPLACE FUNCTION public.fn_tenant_limite(p_tenant_id UUID, p_dim TEXT)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier TEXT; v_status TEXT; v_trial TIMESTAMPTZ; v_base INT; v_addons INT;
BEGIN
  SELECT plan_tier, subscription_status, trial_ends_at
    INTO v_tier, v_status, v_trial
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_tier IS NULL THEN RETURN 0; END IF;
  IF v_status = 'trial' AND v_trial IS NOT NULL AND v_trial >= now() THEN
    v_tier := 'pro';   -- durante el trial, límites de Pro (coherente con las features)
  END IF;
  v_base := public.fn_plan_base_limite(v_tier, p_dim);
  IF v_base = -1 THEN RETURN -1; END IF;   -- ilimitado
  SELECT COALESCE(SUM(cantidad), 0) INTO v_addons
    FROM public.tenant_addons
    WHERE tenant_id = p_tenant_id AND dimension = p_dim
      AND (tipo = 'fijo' OR (tipo = 'temporal' AND vence_at > now()));
  RETURN v_base + v_addons;
END $$;

REVOKE ALL ON FUNCTION public.fn_tenant_limite(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tenant_limite(UUID, TEXT) TO authenticated, service_role;
