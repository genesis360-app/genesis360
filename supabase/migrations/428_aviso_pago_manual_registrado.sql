-- 428 — Cuando se registra un pago manual, el cliente se entera
--
-- Decisión de GO (2026-09-15): "campanita + mail, al dueño y a quien avisó 'Ya transferí'". Hasta acá
-- `fn_registrar_pago_manual` extendía el acceso y no avisaba a nadie: el que había avisado la transferencia desde
-- Mi Cuenta se enteraba solo si el agente le respondía el ticket a mano.
--
-- La función es la única puerta de un pago manual (mig 262): la llaman el panel de soporte (`admin-api`
-- `billing.manual_record_payment`) y el pago único con Mercado Pago (`mp-webhook`, rama `|manualpago|`). El aviso va
-- acá, así vale para los dos:
--   1) Consultas de tipo pago abiertas ("Ya transferí"): el equipo responde en el hilo "Registramos tu pago…" y la
--      consulta queda resuelta. A quien avisó le llega por el trigger de las migs 425/426, con link a la consulta.
--   2) Campanita al DUEÑO y al SUPER_USUARIO del negocio que no se enteraron por la consulta, con link a Mi Cuenta.
--   Si el aviso falla, el pago se registra igual (subtransacción): un aviso nunca puede frenar la extensión del acceso.
-- El mail lo manda `admin-api` al registrar el pago desde el panel (la base no manda mails).
--
-- CREATE OR REPLACE sobre la fuente real (DEV = PROD, md5 9a508ea9…): el cálculo del período, el INSERT del pago y el
-- UPDATE del tenant no cambian. Se repiten SECURITY DEFINER y SET search_path (mig 413); los permisos de ejecución
-- (solo service_role) se conservan.

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_manual(p_tenant_id uuid, p_monto numeric, p_medio text, p_referencia text, p_registrado_por uuid, p_mp_payment_id text, p_notas text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ;
  v_fecha    text;
  v_ticket   RECORD;
  v_avisados uuid[] := '{}';
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

  -- Mig 428: avisar al cliente.
  v_fecha := to_char(v_hasta AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');
  BEGIN
    FOR v_ticket IN
      SELECT id, usuario_id FROM public.support_tickets
       WHERE tenant_id = p_tenant_id AND tipo = 'pago' AND estado NOT IN ('resuelto', 'cerrado')
       ORDER BY created_at
    LOOP
      INSERT INTO public.support_messages (ticket_id, autor_tipo, autor_id, cuerpo)
      VALUES (v_ticket.id, 'agente', p_registrado_por,
              'Registramos tu pago. Tu acceso quedó activo hasta el ' || v_fecha || '. ¡Gracias!');
      UPDATE public.support_tickets SET estado = 'resuelto', updated_at = now() WHERE id = v_ticket.id;
      IF v_ticket.usuario_id IS NOT NULL THEN
        v_avisados := v_avisados || v_ticket.usuario_id;
      END IF;
    END LOOP;

    INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url, metadata)
    SELECT p_tenant_id, u.id, 'info', 'Recibimos tu pago',
           'Tu acceso quedó activo hasta el ' || v_fecha || '.',
           '/mi-cuenta',
           jsonb_build_object('origen', 'pago_manual', 'paid_until', v_hasta)
      FROM public.users u
     WHERE u.tenant_id = p_tenant_id
       AND u.rol IN ('DUEÑO', 'SUPER_USUARIO')
       AND coalesce(u.activo, true)
       AND NOT (u.id = ANY (v_avisados));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fn_registrar_pago_manual] pago registrado para %, pero no se pudo avisar: %', p_tenant_id, SQLERRM;
  END;

  RETURN v_hasta;
END $function$;
