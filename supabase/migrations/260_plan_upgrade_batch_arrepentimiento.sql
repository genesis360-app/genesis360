-- 260: Fase 2 del batch — cambio de PLAN (upgrade) con delta / programado — + flujo de
-- ARREPENTIMIENTO (Ley 24.240 art. 34 / regla click-to-cancel). Aditiva.
--
-- Cambio de PLAN (spec GO 2026-07-07, wiki/features/configurador-addons-batch.md §4):
--   • E1 upgrade INMEDIATO: paga hoy la diferencia de plan (pago único, mismo circuito
--     |addonbatch| del webhook) y el tier se habilita al confirmarse el pago (fail-closed).
--     La fecha de cobro original NUNCA cambia (PUT transaction_amount no toca
--     next_payment_date — validado e2e v1.114).
--   • E2 upgrade PROGRAMADO: el change queda 'programado' para la próxima fecha de cobro;
--     el sweep (EF mp-batch-sweep, GH Actions horario) hace el PUT del monto nuevo en la
--     ventana previa → 'esperando_cobro' → el tier se habilita recién cuando el cobro del
--     monto nuevo se confirma en MP (si falla el cobro, no se habilita — fail-closed).
--   • fn_aplicar_addon_batch v2: además de sincronizar packs, aplica plan_objetivo →
--     tenants.plan_tier (fuente de verdad de límites desde mig 251) + max_users/max_productos
--     base del tier (legacy, solo consistencia).
--
-- Arrepentimiento (Condición A) vs cancelación estándar (Condición B):
--   • tenants.primera_compra_at: primera activación PAGA del tenant (trigger). Ventana de
--     arrepentimiento = 10 días corridos desde acá. NO se resetea en re-suscripciones.
--   • billing_cancelaciones: log de solicitudes (tenant, user, tipo, detalle con refunds).

-- 1) addon_batch_changes: objetivo de PLAN + programación
ALTER TABLE public.addon_batch_changes
  ADD COLUMN IF NOT EXISTS plan_objetivo TEXT
    CHECK (plan_objetivo IN ('basico','pro')),
  ADD COLUMN IF NOT EXISTS programado_para TIMESTAMPTZ;

COMMENT ON COLUMN public.addon_batch_changes.plan_objetivo IS
  'Tier destino cuando el batch incluye cambio de PLAN (Fase 2). NULL = solo packs.';
COMMENT ON COLUMN public.addon_batch_changes.programado_para IS
  'E2: fecha del próximo cobro a la que se programó el cambio (next_payment_date de MP al confirmar).';

-- Estados nuevos: 'programado' (agendado, sin PUT todavía) y 'esperando_cobro'
-- (el sweep ya hizo el PUT; falta que MP confirme el cobro del monto nuevo).
ALTER TABLE public.addon_batch_changes DROP CONSTRAINT IF EXISTS addon_batch_changes_estado_check;
ALTER TABLE public.addon_batch_changes ADD CONSTRAINT addon_batch_changes_estado_check
  CHECK (estado IN ('pendiente_pago','programado','esperando_cobro','aplicado','cancelado','fallido'));

-- Un solo cambio programado/en curso por tenant (mismo lock natural que pendiente_pago)
CREATE UNIQUE INDEX IF NOT EXISTS uq_addon_batch_programado
  ON public.addon_batch_changes(tenant_id) WHERE estado IN ('programado','esperando_cobro');

-- 2) fn_aplicar_addon_batch v2: aplica también el cambio de PLAN (plan_objetivo).
--    Acepta 'pendiente_pago' (E1, lo confirma el webhook al pagar) y 'esperando_cobro'
--    (E2, lo confirma el sweep al verificar el cobro del monto nuevo).
CREATE OR REPLACE FUNCTION public.fn_aplicar_addon_batch(p_tenant_id UUID, p_change_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Estado objetivo reemplaza a los fijos actuales (un pack por dimensión).
  DELETE FROM public.tenant_addons WHERE tenant_id = p_tenant_id AND tipo = 'fijo';
  INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo, vence_at)
  SELECT p_tenant_id, x.dimension, x.cantidad, 'fijo', NULL
  FROM jsonb_to_recordset(v_packs) AS x(dimension TEXT, cantidad INT)
  WHERE x.cantidad > 0;

  -- Cambio de PLAN (Fase 2): plan_tier es la fuente de verdad de límites (mig 251);
  -- max_users/max_productos legacy se setean al base del tier solo por consistencia.
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
END $$;
REVOKE ALL ON FUNCTION public.fn_aplicar_addon_batch(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_addon_batch(UUID, UUID) TO service_role;

-- 3) Primera compra del tenant (ventana de arrepentimiento = 10 días corridos desde acá).
--    La setea un trigger en la PRIMERA transición a 'active' con suscripción MP linkeada
--    (cubre los 3 caminos de activación: mp-verificar, webhook, admin-api.link_subscription).
--    Solo si estaba NULL → una re-suscripción posterior NO abre otra ventana.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS primera_compra_at TIMESTAMPTZ;
COMMENT ON COLUMN public.tenants.primera_compra_at IS
  'Primera activación PAGA (trigger fn_set_primera_compra). Ventana de arrepentimiento Ley 24.240 = +10 días corridos.';

CREATE OR REPLACE FUNCTION public.fn_set_primera_compra()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subscription_status = 'active'
     AND COALESCE(OLD.subscription_status, '') <> 'active'
     AND NEW.mp_subscription_id IS NOT NULL
     AND NEW.primera_compra_at IS NULL THEN
    NEW.primera_compra_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_primera_compra ON public.tenants;
CREATE TRIGGER trg_set_primera_compra
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_primera_compra();

-- 4) Log de solicitudes de baja (requisito legal: quién, cuándo, qué tipo).
--    Solo service_role (la escribe el EF cancel-suscripcion) — como mp_billing_alertas.
CREATE TABLE IF NOT EXISTS public.billing_cancelaciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID,                  -- auth uid del solicitante (sin FK: el user puede borrarse después)
  tipo       TEXT NOT NULL CHECK (tipo IN ('arrepentimiento','cancelacion_estandar')),
  -- refunds ejecutados, preapproval cancelado, period_end aplicado, etc.
  detalle    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_cancelaciones_tenant
  ON public.billing_cancelaciones(tenant_id, created_at DESC);

ALTER TABLE public.billing_cancelaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cancelaciones FROM PUBLIC;
REVOKE ALL ON public.billing_cancelaciones FROM anon;
REVOKE ALL ON public.billing_cancelaciones FROM authenticated;
GRANT ALL ON public.billing_cancelaciones TO service_role;
