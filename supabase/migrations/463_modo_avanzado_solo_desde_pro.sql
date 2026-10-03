-- 463 — PR-8 (GO 2026-10-02): el modo avanzado ("logística inteligente") es solo desde el plan Pro
--
-- La app ya trataba al modo como EFECTIVO (`esModoAvanzado`: modo_operacion = 'avanzado' Y el plan tiene `wms`), pero la
-- base lee `tenants.modo_operacion` a secas en ~10 lugares (guard de ubicación de la mig 455, desarmado de KIT, tareas
-- del repositor, precio programado…). Un negocio con 'avanzado' guardado y un plan sin `wms` veía la app en básico
-- (sin elegir ubicación) y la base le rechazaba cada ingreso de stock. Con v7 pasa en cuanto un alta nueva elige avanzado
-- durante la prueba (Pro) y después paga Básico.
--
-- Invariante desde acá: modo_operacion = 'avanzado' SOLO si el plan efectivo incluye `wms`. Así la columna vuelve a
-- ser la verdad para todos sus lectores.
--   · Activar avanzado sin el plan → rechazo ("disponible desde el plan Pro").
--   · El plan cambia y deja de incluir `wms` (pagó Básico, bajó de plan) → pasa a básico solo y se avisa al dueño.
--     El modo básico solo gatea pantallas: las ubicaciones y el stock quedan intactos.
-- Plan efectivo = espejo de fn_tenant_limite / tierEfectivo (prueba vigente → Pro) + los módulos heredados de v6
-- (tenant_herencia_plan, mig 457: los negocios existentes conservan `wms`).
-- Al aplicar no cambia nadie: los avanzados de PROD son Pro o heredan Pro v6.

CREATE OR REPLACE FUNCTION public.fn_plan_permite_modo_avanzado(
  p_tenant_id uuid, p_tier text, p_status text, p_trial_ends_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (CASE WHEN p_status = 'trial' AND p_trial_ends_at IS NOT NULL AND p_trial_ends_at >= now() THEN 'pro'
               ELSE COALESCE(p_tier, 'free') END) IN ('pro', 'enterprise')
      OR EXISTS (SELECT 1 FROM public.tenant_herencia_plan h
                  WHERE h.tenant_id = p_tenant_id AND 'wms' = ANY (h.features));
$$;

COMMENT ON FUNCTION public.fn_plan_permite_modo_avanzado(uuid, text, text, timestamptz) IS
  'Mig 463 (PR-8): el plan efectivo incluye wms (modo avanzado). Espejo de featuresEfectivas(tierEfectivo(...)).';

REVOKE ALL ON FUNCTION public.fn_plan_permite_modo_avanzado(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plan_permite_modo_avanzado(uuid, text, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_tenants_modo_segun_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.modo_operacion IS DISTINCT FROM 'avanzado' THEN RETURN NEW; END IF;
  IF public.fn_plan_permite_modo_avanzado(NEW.id, NEW.plan_tier, NEW.subscription_status, NEW.trial_ends_at) THEN
    RETURN NEW;
  END IF;

  -- Alguien quiere ACTIVAR el modo avanzado sin el plan → rechazo.
  IF TG_OP = 'INSERT' OR OLD.modo_operacion IS DISTINCT FROM 'avanzado' THEN
    RAISE EXCEPTION 'El modo avanzado (logística inteligente) está disponible desde el plan Pro.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ya estaba en avanzado y el PLAN dejó de incluirlo → pasa a básico y se avisa.
  NEW.modo_operacion := 'basico';
  INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
  SELECT NEW.id, u.id, 'warning',
         'Tu negocio pasó a modo básico',
         'Tu plan actual no incluye el modo avanzado (logística inteligente), que está disponible desde el plan Pro. '
           || 'Tus ubicaciones y tu stock quedan guardados: si pasás a Pro, volvés a activarlo desde Configuración.',
         '/suscripcion'
    FROM public.users u
   WHERE u.tenant_id = NEW.id AND u.rol IN ('DUEÑO', 'SUPER_USUARIO');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_tenants_modo_segun_plan() IS
  'Mig 463 (PR-8): modo_operacion = avanzado solo con un plan que incluya wms; si el plan lo pierde, pasa a básico y avisa.';

DROP TRIGGER IF EXISTS trg_tenants_modo_segun_plan ON public.tenants;
CREATE TRIGGER trg_tenants_modo_segun_plan
  BEFORE INSERT OR UPDATE OF modo_operacion, plan_tier, subscription_status, trial_ends_at ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_tenants_modo_segun_plan();
