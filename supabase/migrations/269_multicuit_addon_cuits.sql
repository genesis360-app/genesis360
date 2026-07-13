-- 269: Multi-CUIT (F5) — Fase 6: monetización por add-on "CUIT adicional".
--
-- El 1er emisor está incluido en todos los planes (es el CUIT del negocio). Emisores
-- ADICIONALES activos consumen cupo de la dimensión 'cuits' (base 1 en todos los planes;
-- se sube con el add-on "CUIT adicional", reusa el motor de add-ons batch ya validado).
-- Enforcement server-side (REGLA #0 de ingresos): no se puede activar el emisor N+1 sin
-- cupo, ni siquiera por API. Espejo de PLAN_BASE_LIMITS/ADDON_PACKS en src/config/brand.ts.
--
-- Alcance seguro: base = 1 CUIT en TODOS los planes (incl. free) → ningún tenant existente
-- queda bloqueado (todos tienen exactamente 1 emisor default hoy). Solo se bloquea ACTIVAR
-- un emisor adicional por encima del cupo; el emisor default (es_default) nunca cuenta.

-- 1) La dimensión 'cuits' entra al CHECK de tenant_addons (packs comprables).
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_dimension_check;
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_dimension_check
  CHECK (dimension IN ('sku','movimientos','comprobantes','sucursales','usuarios','cuits'));

-- 2) fn_plan_base_limite: base de 'cuits' = 1 en todos los planes (Enterprise ilimitado).
--    (Se re-crea con la dimensión nueva; el resto queda idéntico a mig 259.)
CREATE OR REPLACE FUNCTION public.fn_plan_base_limite(p_tier TEXT, p_dim TEXT)
RETURNS INT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE p_tier
    WHEN 'enterprise' THEN -1
    WHEN 'pro' THEN CASE p_dim
      WHEN 'sku' THEN 8000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 14000
      WHEN 'sucursales' THEN 4 WHEN 'usuarios' THEN 15 WHEN 'cuits' THEN 1 ELSE 0 END
    WHEN 'basico' THEN CASE p_dim
      WHEN 'sku' THEN 2000 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 6000
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 5 WHEN 'cuits' THEN 1 ELSE 0 END
    ELSE CASE p_dim  -- free
      WHEN 'sku' THEN 50 WHEN 'movimientos' THEN -1 WHEN 'comprobantes' THEN 200
      WHEN 'sucursales' THEN 1 WHEN 'usuarios' THEN 1 WHEN 'cuits' THEN 1 ELSE 0 END
  END
$$;

-- 3) Enforcement en emisores_fiscales. NO se reusa fn_enforce_limite genérico porque el
--    emisor DEFAULT (es_default) es el CUIT del negocio y NO consume cupo — solo cuentan
--    los adicionales activos. Trigger propio, mismo espíritu (SECURITY DEFINER, ERRCODE).
CREATE OR REPLACE FUNCTION public.fn_enforce_limite_cuits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limite INT;
  v_count  INT;
BEGIN
  -- El emisor principal (default) es el CUIT del negocio: nunca consume cupo.
  IF NEW.es_default IS TRUE THEN RETURN NEW; END IF;
  -- Solo consume si queda ACTIVO. En UPDATE, solo si REACTIVA (no un update normal).
  IF NEW.activo IS DISTINCT FROM TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.activo IS TRUE THEN RETURN NEW; END IF;

  v_limite := public.fn_tenant_limite(NEW.tenant_id, 'cuits');
  IF v_limite = -1 THEN RETURN NEW; END IF;   -- ilimitado (Enterprise)

  -- Cuántos emisores ADICIONALES activos ya hay (sin contar el default ni esta misma fila).
  SELECT count(*) INTO v_count FROM public.emisores_fiscales
    WHERE tenant_id = NEW.tenant_id AND activo = true AND es_default = false
      AND id <> NEW.id;

  -- El límite incluye el 1 base del negocio (el default) → los adicionales permitidos son (limite - 1).
  IF v_count >= GREATEST(v_limite - 1, 0) THEN
    RAISE EXCEPTION 'Límite de CUITs del plan alcanzado (% adicional(es) permitido(s)). Sumá el add-on "CUIT adicional" para facturar con otra razón social.',
      GREATEST(v_limite - 1, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.fn_enforce_limite_cuits() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_enforce_cuits ON public.emisores_fiscales;
CREATE TRIGGER trg_enforce_cuits
  BEFORE INSERT OR UPDATE OF activo, es_default ON public.emisores_fiscales
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_limite_cuits();
