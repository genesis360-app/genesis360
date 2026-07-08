-- 262: Motor de pago MANUAL (billing_mode) — alternativa a la suscripción automática de MP,
-- a precio de lista, pagable por transferencia/efectivo/MP pago único/otro. Diseño: plan
-- aprobado 2026-07-08 (facturación de Fede + pago manual).
--
--   • tenants.billing_mode: 'auto' (hoy, MP recurrente con -10%) | 'manual' (lista, mes a mes).
--   • manual_paid_until: fecha hasta la que está pago. El ÚNICO gate de acceso sigue siendo
--     `subscription_status` (active/inactive) — accesoSuscripcion.ts / SubscriptionGuard NO
--     se tocan. Un sweep (billing-manual-sweep) flipea el status igual que ya hace mp-webhook
--     para el modo auto.
--   • billing_manual_pagos: historial de pagos (transferencia/efectivo/MP pago único/otro).
--   • fn_registrar_pago_manual: única puerta de escritura — la llaman las 3 formas de pagar
--     (MP pago único vía webhook, "avisé que pagué" NO la llama —solo notifica—, carga staff).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (billing_mode IN ('auto','manual')),
  ADD COLUMN IF NOT EXISTS manual_monto_mensual NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS manual_paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_ultimo_recordatorio_tipo TEXT,
  ADD COLUMN IF NOT EXISTS manual_ultimo_recordatorio_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tenants.billing_mode IS
  'auto = suscripción MP recurrente (-10%). manual = pago mes a mes a precio de lista (transferencia/efectivo/MP único/otro).';
COMMENT ON COLUMN public.tenants.manual_monto_mensual IS
  'Precio de lista congelado al momento del switch a manual (no se reescribe retroactivamente si cambia el precio de lista).';
COMMENT ON COLUMN public.tenants.manual_paid_until IS
  'Fecha hasta la que el tenant en modo manual tiene acceso pago. El gate real de acceso sigue siendo subscription_status.';

CREATE TABLE IF NOT EXISTS public.billing_manual_pagos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  monto          NUMERIC(12,2) NOT NULL,
  medio          TEXT NOT NULL CHECK (medio IN ('transferencia','efectivo','tarjeta_mp','otro')),
  referencia     TEXT,
  periodo_desde  TIMESTAMPTZ NOT NULL,
  periodo_hasta  TIMESTAMPTZ NOT NULL,
  registrado_por UUID REFERENCES public.support_agents(id) ON DELETE SET NULL,  -- NULL = automático (MP)
  mp_payment_id  TEXT,
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_manual_pagos_mp_payment
  ON public.billing_manual_pagos(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_manual_pagos_tenant
  ON public.billing_manual_pagos(tenant_id, created_at DESC);

ALTER TABLE public.billing_manual_pagos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='billing_manual_pagos' AND policyname='billing_manual_pagos_select') THEN
    CREATE POLICY billing_manual_pagos_select ON public.billing_manual_pagos FOR SELECT
      USING (tenant_id = public.get_user_tenant_id() OR public.is_admin());
  END IF;
END $$;
REVOKE ALL ON public.billing_manual_pagos FROM PUBLIC;
REVOKE ALL ON public.billing_manual_pagos FROM anon;
GRANT SELECT ON public.billing_manual_pagos TO authenticated;
GRANT ALL ON public.billing_manual_pagos TO service_role;

-- Única función que escribe un pago manual y extiende el acceso — SECURITY DEFINER, mismo
-- patrón que fn_aplicar_addon_batch (migs 258/260). Extiende desde el mayor entre "ahora" y
-- el paid_until actual (paga antes de vencer → no pierde días ya pagados).
CREATE OR REPLACE FUNCTION public.fn_registrar_pago_manual(
  p_tenant_id      UUID,
  p_monto          NUMERIC,
  p_medio          TEXT,
  p_referencia     TEXT,
  p_registrado_por UUID,
  p_mp_payment_id  TEXT,
  p_notas          TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ;
BEGIN
  SELECT GREATEST(now(), COALESCE(manual_paid_until, now())) INTO v_desde
    FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id;
  END IF;
  v_hasta := v_desde + INTERVAL '1 month';

  INSERT INTO public.billing_manual_pagos (
    tenant_id, monto, medio, referencia, periodo_desde, periodo_hasta,
    registrado_por, mp_payment_id, notas
  ) VALUES (
    p_tenant_id, p_monto, p_medio, p_referencia, v_desde, v_hasta,
    p_registrado_por, p_mp_payment_id, p_notas
  );

  UPDATE public.tenants SET
    manual_paid_until = v_hasta,
    subscription_status = CASE WHEN subscription_status = 'inactive' THEN 'active' ELSE subscription_status END,
    manual_ultimo_recordatorio_tipo = NULL,
    manual_ultimo_recordatorio_at = NULL
  WHERE id = p_tenant_id;

  RETURN v_hasta;
END $$;
REVOKE ALL ON FUNCTION public.fn_registrar_pago_manual(UUID,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_pago_manual(UUID,NUMERIC,TEXT,TEXT,UUID,TEXT,TEXT) TO service_role;

-- Cambiar a modo manual: el DUEÑO puede pedirlo desde el cliente, pero el MONTO NUNCA sale
-- del cliente (REGLA #0 — billing-manual-pagar cobra manual_monto_mensual tal cual llega de
-- DB). Esta función deriva el precio de lista server-side (espejo de PRECIO_LISTA en
-- brand.ts) según el plan_tier actual del tenant — el cliente no puede pasar ningún monto.
-- callable por 'authenticated' (auth.uid() debe ser DUEÑO del tenant — se valida acá, no en
-- una policy, porque la función además escribe billing_mode).
CREATE OR REPLACE FUNCTION public.fn_activar_billing_manual(p_tenant_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier   TEXT;
  v_precio NUMERIC;
  v_es_dueño BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND tenant_id = p_tenant_id AND rol = 'DUEÑO'
  ) INTO v_es_dueño;
  IF NOT v_es_dueño THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar el modo de pago';
  END IF;

  SELECT plan_tier INTO v_tier FROM public.tenants WHERE id = p_tenant_id;
  v_precio := CASE v_tier
    WHEN 'basico' THEN 60000
    WHEN 'pro'    THEN 100000
    ELSE NULL
  END;
  IF v_precio IS NULL THEN
    RAISE EXCEPTION 'Plan % no tiene precio de lista para modo manual', v_tier;
  END IF;

  UPDATE public.tenants SET billing_mode = 'manual', manual_monto_mensual = v_precio
    WHERE id = p_tenant_id;
  RETURN v_precio;
END $$;
REVOKE ALL ON FUNCTION public.fn_activar_billing_manual(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_activar_billing_manual(UUID) TO authenticated;
