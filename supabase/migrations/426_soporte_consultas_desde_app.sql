-- 426 — Consultas de soporte desde la app (Ayuda, fase 1)
--
-- Pedido de GO (2026-09-15): terminar "Reportar un problema" de Ayuda y que el cliente pueda seguir y responder su
-- consulta. Hasta acá el formulario de Ayuda solo mandaba un mail a soporte (sin ticket), y el cliente no tenía dónde ver
-- lo que había reportado ni la respuesta. Decisiones de GO: cada usuario ve sus consultas y el DUEÑO/SUPER_USUARIO ve todas
-- las del negocio; el equipo se entera por mail y por una marca en el panel.
--
-- Piezas:
--   1) `support_tickets`: quién la abrió (`usuario_id`), tipo, módulo, `pendiente_equipo` (la marca del panel) y la fecha
--      del último mensaje. `support_messages`: `interno` (notas del equipo que el cliente no ve) y `adjuntos`.
--   2) Trigger: cuando escribe el cliente la consulta queda pendiente del equipo (y se reabre si estaba esperando o
--      resuelta); cuando responde un agente sin nota interna, deja de estar pendiente.
--   3) El aviso de la 425 ignora las notas internas y lleva a Ayuda → Mis consultas.
--   4) RPC para la app (SECURITY DEFINER, con guard): crear, responder, listar y ver una consulta. Las tablas siguen sin
--      privilegios para `authenticated` (mig 425): todo pasa por estas funciones.
--   5) Bucket privado `soporte-adjuntos` (`<negocio>/<usuario>/<archivo>`), con políticas por negocio.
--
-- Los tickets que abre el equipo desde el panel (sin `usuario_id`) siguen siendo internos: la app no los muestra.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Columnas
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS modulo text,
  ADD COLUMN IF NOT EXISTS pendiente_equipo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ultimo_mensaje_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_tipo_check') THEN
    ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_tipo_check
      CHECK (tipo IS NULL OR tipo IN ('problema', 'consulta', 'sugerencia', 'pago'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_support_tickets_usuario
  ON public.support_tickets (tenant_id, usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_pendiente_equipo
  ON public.support_tickets (updated_at DESC) WHERE pendiente_equipo;

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS interno boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adjuntos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.support_tickets.usuario_id IS 'Usuario del negocio que abrió la consulta desde la app. NULL = ticket interno del equipo. Mig 426.';
COMMENT ON COLUMN public.support_tickets.pendiente_equipo IS 'El último mensaje es del cliente y el equipo todavía no respondió (marca del panel). Mig 426.';
COMMENT ON COLUMN public.support_messages.interno IS 'Nota del equipo: el cliente no la ve ni recibe aviso. Mig 426.';

-- Datos existentes: quién abrió cada ticket (primer mensaje de cliente que sigue en el negocio), último mensaje y marca.
UPDATE public.support_tickets t
   SET usuario_id = x.autor_id
  FROM (SELECT DISTINCT ON (m.ticket_id) m.ticket_id, m.autor_id
          FROM public.support_messages m
          JOIN public.support_tickets tt ON tt.id = m.ticket_id
          JOIN public.users u ON u.id = m.autor_id AND u.tenant_id = tt.tenant_id
         WHERE m.autor_tipo = 'cliente'
         ORDER BY m.ticket_id, m.created_at) x
 WHERE t.id = x.ticket_id AND t.usuario_id IS NULL;

UPDATE public.support_tickets t
   SET ultimo_mensaje_at = x.ultimo
  FROM (SELECT ticket_id, max(created_at) AS ultimo FROM public.support_messages GROUP BY ticket_id) x
 WHERE t.id = x.ticket_id AND t.ultimo_mensaje_at IS NULL;

UPDATE public.support_tickets t
   SET pendiente_equipo = true
 WHERE t.estado NOT IN ('resuelto', 'cerrado')
   AND (SELECT m.autor_tipo FROM public.support_messages m
         WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) = 'cliente';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) ¿El usuario logueado ve todas las consultas del negocio? (DUEÑO / SUPER_USUARIO)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_soporte_ve_todas_del_negocio()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid() AND rol IN ('DUEÑO', 'SUPER_USUARIO') AND coalesce(activo, true)
  )
$$;

REVOKE ALL ON FUNCTION public.fn_soporte_ve_todas_del_negocio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soporte_ve_todas_del_negocio() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) El ticket se acomoda solo con cada mensaje
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_support_message_actualiza_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.autor_tipo = 'cliente' THEN
    UPDATE public.support_tickets t
       SET pendiente_equipo  = true,
           ultimo_mensaje_at = NEW.created_at,
           updated_at        = now(),
           estado            = CASE WHEN t.estado IN ('esperando', 'resuelto') THEN 'abierto' ELSE t.estado END,
           usuario_id        = coalesce(t.usuario_id,
                                 (SELECT u.id FROM public.users u WHERE u.id = NEW.autor_id AND u.tenant_id = t.tenant_id))
     WHERE t.id = NEW.ticket_id;
  ELSIF NEW.autor_tipo = 'agente' AND NOT NEW.interno THEN
    UPDATE public.support_tickets
       SET pendiente_equipo = false, ultimo_mensaje_at = NEW.created_at, updated_at = now()
     WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_support_message_actualiza_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_message_actualiza_ticket ON public.support_messages;
CREATE TRIGGER trg_support_message_actualiza_ticket
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_support_message_actualiza_ticket();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Aviso de respuesta (mig 425): sin notas internas, y a quién abrió la consulta
-- ─────────────────────────────────────────────────────────────────────────────────────────────
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
  IF NEW.interno THEN
    RETURN NEW;  -- Mig 426: una nota del equipo no se avisa
  END IF;

  SELECT id, tenant_id, asunto, usuario_id INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Mig 426: quien abrió la consulta; si no está guardado, el primer mensaje del cliente (tickets de antes de la 426).
  SELECT u.id INTO v_cliente
    FROM public.users u
   WHERE u.id = v_ticket.usuario_id AND u.tenant_id = v_ticket.tenant_id;
  IF v_cliente IS NULL THEN
    SELECT m.autor_id INTO v_cliente
      FROM public.support_messages m
      JOIN public.users u ON u.id = m.autor_id AND u.tenant_id = v_ticket.tenant_id
     WHERE m.ticket_id = NEW.ticket_id AND m.autor_tipo = 'cliente'
     ORDER BY m.created_at
     LIMIT 1;
  END IF;
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
          '/ayuda/consultas?ticket=' || NEW.ticket_id,
          jsonb_build_object('origen', 'soporte', 'ticket_id', NEW.ticket_id, 'mensaje_id', NEW.id));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La respuesta del agente se guarda igual: un aviso que no sale no puede frenar el panel.
  RAISE WARNING '[fn_notificar_respuesta_soporte] mensaje %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_respuesta_soporte ON public.support_messages;
CREATE TRIGGER trg_notificar_respuesta_soporte
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  WHEN (NEW.autor_tipo = 'agente' AND NOT NEW.interno)
  EXECUTE FUNCTION public.fn_notificar_respuesta_soporte();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) Adjuntos: validación (uso interno de las RPC)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Cada adjunto tiene que ser un archivo ya subido al bucket, en la carpeta del negocio y del usuario que escribe.
CREATE OR REPLACE FUNCTION public.fn_soporte_adjuntos_validos(p_adjuntos jsonb, p_tenant uuid, p_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a          jsonb;
  v_path     text;
  v_limpios  jsonb := '[]'::jsonb;
BEGIN
  IF p_adjuntos IS NULL OR jsonb_typeof(p_adjuntos) = 'null' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_adjuntos) <> 'array' THEN
    RAISE EXCEPTION 'Adjuntos inválidos.';
  END IF;
  IF jsonb_array_length(p_adjuntos) > 3 THEN
    RAISE EXCEPTION 'Podés adjuntar hasta 3 archivos.';
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(p_adjuntos) LOOP
    v_path := a->>'path';
    IF v_path IS NULL OR v_path NOT LIKE p_tenant::text || '/' || p_usuario::text || '/%' OR v_path LIKE '%..%' THEN
      RAISE EXCEPTION 'Adjunto inválido.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'soporte-adjuntos' AND o.name = v_path) THEN
      RAISE EXCEPTION 'No encontramos el archivo adjunto. Volvé a subirlo.';
    END IF;
    v_limpios := v_limpios || jsonb_build_array(jsonb_build_object(
      'path', v_path,
      'nombre', left(coalesce(a->>'nombre', 'archivo'), 120),
      'tipo', left(coalesce(a->>'tipo', ''), 60)));
  END LOOP;
  RETURN v_limpios;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_soporte_adjuntos_validos(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) RPC: crear una consulta
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_soporte_crear_consulta(
  p_asunto   text,
  p_cuerpo   text,
  p_tipo     text  DEFAULT 'problema',
  p_urgencia text  DEFAULT 'media',
  p_modulo   text  DEFAULT NULL,
  p_adjuntos jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_asunto  text := btrim(coalesce(p_asunto, ''));
  v_cuerpo  text := btrim(coalesce(p_cuerpo, ''));
  v_adjs    jsonb;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.users WHERE id = v_uid AND coalesce(activo, true);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF length(v_asunto) < 3 OR length(v_asunto) > 120 THEN
    RAISE EXCEPTION 'El asunto tiene que tener entre 3 y 120 caracteres.';
  END IF;
  IF length(v_cuerpo) < 1 OR length(v_cuerpo) > 4000 THEN
    RAISE EXCEPTION 'Contanos qué pasa (hasta 4000 caracteres).';
  END IF;
  IF coalesce(p_tipo, '') NOT IN ('problema', 'consulta', 'sugerencia') THEN
    RAISE EXCEPTION 'Tipo de consulta inválido.';
  END IF;
  IF coalesce(p_urgencia, '') NOT IN ('baja', 'media', 'alta') THEN
    RAISE EXCEPTION 'Urgencia inválida.';
  END IF;
  -- El tope se cuenta de a un pedido por usuario: sin el lock, una ráfaga concurrente pasaría el COUNT toda junta.
  PERFORM pg_advisory_xact_lock(hashtext('soporte-consulta:' || v_uid::text));
  IF (SELECT count(*) FROM public.support_tickets
       WHERE usuario_id = v_uid AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'Ya enviaste 10 consultas hoy. Si es urgente, escribinos a soporte@genesis360.pro.';
  END IF;

  v_adjs := public.fn_soporte_adjuntos_validos(p_adjuntos, v_tenant, v_uid);

  INSERT INTO public.support_tickets (tenant_id, asunto, estado, prioridad, canal, usuario_id, tipo, modulo)
  VALUES (v_tenant, v_asunto, 'abierto', p_urgencia, 'in_app', v_uid, p_tipo, left(btrim(p_modulo), 80))
  RETURNING id INTO v_id;

  INSERT INTO public.support_messages (ticket_id, autor_tipo, autor_id, cuerpo, adjuntos)
  VALUES (v_id, 'cliente', v_uid, v_cuerpo, v_adjs);

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7) RPC: responder una consulta
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_soporte_responder(
  p_ticket_id uuid,
  p_cuerpo    text,
  p_adjuntos  jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_ticket  RECORD;
  v_cuerpo  text := btrim(coalesce(p_cuerpo, ''));
  v_adjs    jsonb;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.users WHERE id = v_uid AND coalesce(activo, true);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, estado INTO v_ticket
    FROM public.support_tickets
   WHERE id = p_ticket_id
     AND tenant_id = v_tenant
     AND usuario_id IS NOT NULL
     AND (usuario_id = v_uid OR public.fn_soporte_ve_todas_del_negocio())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta no encontrada.';
  END IF;
  IF v_ticket.estado = 'cerrado' THEN
    RAISE EXCEPTION 'Esta consulta está cerrada. Si necesitás algo más, abrí una nueva.';
  END IF;
  IF length(v_cuerpo) < 1 OR length(v_cuerpo) > 4000 THEN
    RAISE EXCEPTION 'Escribí tu respuesta (hasta 4000 caracteres).';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('soporte-respuesta:' || v_uid::text));
  IF (SELECT count(*) FROM public.support_messages
       WHERE autor_tipo = 'cliente' AND autor_id = v_uid AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Mandaste muchos mensajes seguidos. Esperá un rato o escribinos a soporte@genesis360.pro.';
  END IF;

  v_adjs := public.fn_soporte_adjuntos_validos(p_adjuntos, v_tenant, v_uid);

  INSERT INTO public.support_messages (ticket_id, autor_tipo, autor_id, cuerpo, adjuntos)
  VALUES (p_ticket_id, 'cliente', v_uid, v_cuerpo, v_adjs)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 8) RPC: mis consultas (DUEÑO / SUPER_USUARIO: todas las del negocio)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_soporte_mis_consultas()
RETURNS TABLE (
  id                uuid,
  asunto            text,
  estado            text,
  tipo              text,
  prioridad         text,
  created_at        timestamptz,
  ultimo_mensaje_at timestamptz,
  usuario_id        uuid,
  usuario_nombre    text,
  es_mia            boolean,
  ultimo_autor      text,
  mensajes          integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id, t.asunto, t.estado, t.tipo, t.prioridad, t.created_at,
         coalesce(t.ultimo_mensaje_at, t.created_at),
         t.usuario_id, u.nombre_display, t.usuario_id = auth.uid(),
         (SELECT m.autor_tipo FROM public.support_messages m
           WHERE m.ticket_id = t.id AND NOT m.interno ORDER BY m.created_at DESC LIMIT 1),
         (SELECT count(*)::int FROM public.support_messages m WHERE m.ticket_id = t.id AND NOT m.interno)
    FROM public.support_tickets t
    LEFT JOIN public.users u ON u.id = t.usuario_id
   WHERE t.tenant_id = public.get_user_tenant_id()
     AND EXISTS (SELECT 1 FROM public.users yo WHERE yo.id = auth.uid() AND coalesce(yo.activo, true))
     AND t.usuario_id IS NOT NULL
     AND (t.usuario_id = auth.uid() OR public.fn_soporte_ve_todas_del_negocio())
   ORDER BY coalesce(t.ultimo_mensaje_at, t.created_at) DESC
   LIMIT 100
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 9) RPC: una consulta con su hilo (sin notas internas)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_soporte_consulta(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket jsonb;
BEGIN
  SELECT jsonb_build_object(
           'id', t.id, 'asunto', t.asunto, 'estado', t.estado, 'tipo', t.tipo, 'prioridad', t.prioridad,
           'created_at', t.created_at, 'usuario_id', t.usuario_id, 'usuario_nombre', u.nombre_display,
           'es_mia', t.usuario_id = auth.uid())
    INTO v_ticket
    FROM public.support_tickets t
    LEFT JOIN public.users u ON u.id = t.usuario_id
   WHERE t.id = p_ticket_id
     AND t.tenant_id = public.get_user_tenant_id()
     AND EXISTS (SELECT 1 FROM public.users yo WHERE yo.id = auth.uid() AND coalesce(yo.activo, true))
     AND t.usuario_id IS NOT NULL
     AND (t.usuario_id = auth.uid() OR public.fn_soporte_ve_todas_del_negocio());
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'Consulta no encontrada.';
  END IF;

  RETURN jsonb_build_object(
    'ticket', v_ticket,
    'mensajes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id,
               'autor_tipo', m.autor_tipo,
               'autor_nombre', CASE WHEN m.autor_tipo = 'cliente' THEN coalesce(uc.nombre_display, 'Cliente')
                                    ELSE 'Soporte Genesis360' END,
               'cuerpo', m.cuerpo,
               'adjuntos', m.adjuntos,
               'created_at', m.created_at) ORDER BY m.created_at)
        FROM public.support_messages m
        LEFT JOIN public.users uc ON uc.id = m.autor_id AND m.autor_tipo = 'cliente'
       WHERE m.ticket_id = p_ticket_id AND NOT m.interno), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_soporte_crear_consulta(text, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_soporte_responder(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_soporte_mis_consultas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_soporte_consulta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soporte_crear_consulta(text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_soporte_responder(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_soporte_mis_consultas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_soporte_consulta(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 10) Bucket de adjuntos: `<negocio>/<usuario>/<archivo>`, imágenes y PDF hasta 5 MB
-- ─────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('soporte-adjuntos', 'soporte-adjuntos', false, 5242880,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS soporte_adjuntos_insert ON storage.objects;
CREATE POLICY soporte_adjuntos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'soporte-adjuntos'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Leer: el propio usuario, o el DUEÑO/SUPER_USUARIO del negocio. El equipo los lee por `admin-api` (service_role).
DROP POLICY IF EXISTS soporte_adjuntos_select ON storage.objects;
CREATE POLICY soporte_adjuntos_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'soporte-adjuntos'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    AND ((storage.foldername(name))[2] = auth.uid()::text OR public.fn_soporte_ve_todas_del_negocio())
  );
