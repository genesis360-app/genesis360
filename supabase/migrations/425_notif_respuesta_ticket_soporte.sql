-- 425 — La respuesta de soporte le llega al cliente como notificación
--
-- Pedido de GO (2026-09-15): el cliente avisa desde Mi Cuenta "Ya transferí" → la EF `billing-manual-avisar-pago`
-- crea un ticket en el panel de soporte. Cuando el equipo responde en ese ticket (`admin-api`
-- `support.tickets.reply`), el mensaje se guardaba en `support_messages` y ahí terminaba: sin notificación, sin mail,
-- y la app no tiene dónde ver tickets (las tablas no tienen policies para `authenticated`). El cliente nunca se
-- enteraba de la respuesta.
--
-- Ahora cada respuesta de un agente le llega a la campanita del headbar (`notificaciones`) al usuario que abrió el
-- ticket. Costo: un INSERT por respuesta; la campanita ya consulta cada 30 segundos, no se agrega polling.
--
-- A quién: al autor del PRIMER mensaje de tipo `cliente` del ticket, y solo si sigue siendo usuario de ese negocio.
-- Los tickets que abre el equipo desde el panel (sin mensaje del cliente) son hilos internos: no se notifica nada.
-- Se hace con un trigger y no en la EF para no depender de redesplegar `admin-api`.

CREATE OR REPLACE FUNCTION public.fn_notificar_respuesta_soporte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket  RECORD;
  v_cliente uuid;
  v_cuerpo  text;
BEGIN
  SELECT id, tenant_id, asunto INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT m.autor_id INTO v_cliente
    FROM public.support_messages m
    JOIN public.users u ON u.id = m.autor_id AND u.tenant_id = v_ticket.tenant_id
   WHERE m.ticket_id = NEW.ticket_id AND m.autor_tipo = 'cliente'
   ORDER BY m.created_at
   LIMIT 1;
  IF v_cliente IS NULL THEN
    RETURN NEW;  -- ticket interno del equipo o el usuario ya no está en el negocio
  END IF;

  v_cuerpo := btrim(NEW.cuerpo);
  IF length(v_cuerpo) > 500 THEN
    v_cuerpo := left(v_cuerpo, 497) || '…';
  END IF;

  INSERT INTO public.notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url, metadata)
  VALUES (v_ticket.tenant_id, v_cliente, 'info',
          'Soporte respondió: ' || left(v_ticket.asunto, 80),
          v_cuerpo,
          NULL,
          jsonb_build_object('origen', 'soporte', 'ticket_id', NEW.ticket_id, 'mensaje_id', NEW.id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La respuesta del agente se guarda igual: un aviso que no sale no puede frenar el panel.
  RAISE WARNING '[fn_notificar_respuesta_soporte] mensaje %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_respuesta_soporte() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notificar_respuesta_soporte ON public.support_messages;
CREATE TRIGGER trg_notificar_respuesta_soporte
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  WHEN (NEW.autor_tipo = 'agente')
  EXECUTE FUNCTION public.fn_notificar_respuesta_soporte();

COMMENT ON FUNCTION public.fn_notificar_respuesta_soporte() IS
  'Avisa en la campanita al usuario del negocio que abrió el ticket cuando un agente responde. Solo tickets con mensaje del cliente. Mig 425.';

-- Higiene: `anon` y `authenticated` tenían todos los privilegios de tabla sobre las dos tablas de soporte, sostenidos
-- solo por "RLS habilitada sin policies" (el mismo patrón que se cerró en `admin_audit_log`, mig 411). Las leen y
-- escriben únicamente la EF `admin-api` y `billing-manual-avisar-pago`, con service_role.
REVOKE ALL ON public.support_tickets FROM anon, authenticated;
REVOKE ALL ON public.support_messages FROM anon, authenticated;
