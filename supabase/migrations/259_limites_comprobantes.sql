-- 259: Pricing v2 (GO 2026-07-05) — la dimensión metered de FLUJO pasa de MOVIMIENTOS a
-- COMPROBANTES (toda venta finalizada del mes; presupuestos/canceladas no cuentan).
-- Enforcement de comprobantes = SOFT (solo aviso/upsell — NUNCA se bloquea una venta,
-- decisión F3b/Q2). Movimientos deja de ser límite (-1 = ilimitado) → los gates viejos de
-- UI pasan solos. Espejo de PLAN_BASE_LIMITS en src/config/brand.ts — mantener en sync.
CREATE OR REPLACE FUNCTION public.fn_plan_base_limite(p_tier TEXT, p_dim TEXT)
RETURNS INT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE p_tier
    WHEN 'enterprise' THEN -1
    WHEN 'pro' THEN CASE p_dim
      WHEN 'sku' THEN 8000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 14000
      WHEN 'sucursales' THEN 4 WHEN 'usuarios' THEN 15 ELSE 0 END
    WHEN 'basico' THEN CASE p_dim
      WHEN 'sku' THEN 2000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 6000
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 5 ELSE 0 END
    ELSE CASE p_dim  -- free
      WHEN 'sku' THEN 50 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 200
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 1 ELSE 0 END
  END
$$;
