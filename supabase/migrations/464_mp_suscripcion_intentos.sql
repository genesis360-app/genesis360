-- 464 — Intentos de suscripción: que un pago de plan no quede huérfano ni se duplique (REGLA #0, plata)
--
-- Incidente 2026-09-28 (2º cliente real): el negocio pagó el plan Pro DOS veces con 40 s de diferencia y ninguna de las
-- dos suscripciones quedó vinculada (el negocio siguió "en prueba"). En el checkout por plan MP NO guarda ni
-- external_reference ni payer_email: el único vínculo es el preapproval_id de la vuelta a /suscripcion, y si esa vuelta
-- no verifica, el pago queda huérfano. La reconciliación horaria (mp-reconciliacion) detectó las dos huérfanas, pero la
-- alerta no decía de quién eran y se descartaron como "prueba". Nada frenaba el segundo pago.
--
-- Esta tabla registra cada vez que alguien sale de /suscripcion hacia el checkout de un plan (negocio, plan, hora):
--   · la app avisa "ya iniciaste un pago hace N minutos, no pagues de nuevo" si hay un intento sin vincular reciente;
--   · mp-reconciliacion cruza cada huérfana con los intentos (mismo plan, hasta 3 h antes) y nombra al negocio
--     candidato en la alerta (y si parece un pago duplicado);
--   · mp-verificar-suscripcion marca el intento como vinculado al activar.

CREATE TABLE IF NOT EXISTS public.mp_suscripcion_intentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  usuario_id     uuid,
  plan_tier      text NOT NULL CHECK (plan_tier IN ('basico', 'pro', 'enterprise')),
  mp_plan_id     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  preapproval_id text,
  vinculado_at   timestamptz
);

CREATE INDEX IF NOT EXISTS mp_suscripcion_intentos_tenant_idx ON public.mp_suscripcion_intentos (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_suscripcion_intentos_plan_idx ON public.mp_suscripcion_intentos (mp_plan_id, created_at DESC);

COMMENT ON TABLE public.mp_suscripcion_intentos IS
  'Mig 464: cada salida de /suscripcion al checkout de un plan de MP. Sirve para frenar el doble pago y para nombrar al negocio de una suscripción huérfana.';

ALTER TABLE public.mp_suscripcion_intentos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mp_suscripcion_intentos'
                   AND policyname = 'mp_suscripcion_intentos_select_propio') THEN
    CREATE POLICY mp_suscripcion_intentos_select_propio ON public.mp_suscripcion_intentos
      FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
  END IF;
END $$;
REVOKE ALL ON public.mp_suscripcion_intentos FROM anon, authenticated;
GRANT SELECT ON public.mp_suscripcion_intentos TO authenticated;

-- El navegador no escribe la tabla directo: el negocio y el usuario salen de la sesión, no del cliente.
CREATE OR REPLACE FUNCTION public.registrar_intento_suscripcion(p_plan_tier text, p_mp_plan_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_id     uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.users WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin negocio'; END IF;
  IF p_plan_tier NOT IN ('basico', 'pro', 'enterprise') OR COALESCE(p_mp_plan_id, '') = '' THEN
    RAISE EXCEPTION 'Plan inválido';
  END IF;
  INSERT INTO public.mp_suscripcion_intentos (tenant_id, usuario_id, plan_tier, mp_plan_id)
  VALUES (v_tenant, auth.uid(), p_plan_tier, p_mp_plan_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_intento_suscripcion(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_intento_suscripcion(text, text) TO authenticated;
