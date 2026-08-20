-- Migration 377: Plan IA — Fase 3 (memoria persistente por tenant). Continúa la Fase 2 (mig 376,
-- capa de RPCs de configuración) — GO ya había definido el diseño en el Artifact original
-- ("IA de configuración con memoria por tenant", 2026-08-14): NO se guarda charla cruda, se
-- guardan HECHOS DESTILADOS que la IA va confirmando con el usuario, y el tenant puede
-- ver/borrar esa memoria desde Configuración.
--
-- Diseño (mismo criterio de mig 376 — REGLA #0, defensa en profundidad):
--   1. Tabla `ai_tenant_memoria`: 1 fila = 1 hecho corto (texto libre acotado, sin categorías —
--      no hay necesidad real de estructurarlo más que eso todavía).
--   2. Escritura SOLO vía `fn_ai_memoria_guardar` (SECURITY DEFINER) — deriva tenant_id/rol del
--      JWT de quien llama (nunca un parámetro), exige DUEÑO/ADMIN (mismo umbral que
--      `fn_ai_config_set_*`, mismo universo que ya puede usar la herramienta de proponer config
--      en el chat). No hay policy de INSERT — un cliente directo no puede escribir, solo la RPC.
--   3. Tope de 20 hechos por tenant, podado dentro de la misma RPC (no hay pg_cron habilitado en
--      este proyecto — ver referencia de memoria — así que la poda es sincrónica, en cada
--      inserción, no un sweep periódico). Motivo del tope: esta lista se inyecta COMPLETA en el
--      system prompt de cada conversación nueva, así que necesita quedar acotada en tamaño.
--   4. Lectura (SELECT) y borrado (DELETE) sí tienen policy propia — a diferencia de
--      `ai_config_audit` (que es solo un log, nunca editable a mano), acá el tenant tiene que
--      poder revisar y borrar su propia memoria desde Configuración (borrado manual, sin RPC:
--      no es una operación que mueva plata/stock/fiscal, alcanza con RLS). Mismo universo que el
--      SELECT de `ai_config_audit`: DUEÑO/ADMIN/SUPER_USUARIO.
--
-- Ver G360.Wiki/wiki/features/asistente-ia.md (sección "Plan IA") y el Artifact de la propuesta.

CREATE TABLE IF NOT EXISTS public.ai_tenant_memoria (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hecho text NOT NULL,
  usuario_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_tenant_memoria_pkey PRIMARY KEY (id),
  CONSTRAINT ai_tenant_memoria_hecho_no_vacio CHECK (length(trim(hecho)) > 0 AND length(hecho) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_ai_tenant_memoria_tenant ON public.ai_tenant_memoria USING btree (tenant_id, created_at DESC);

ALTER TABLE public.ai_tenant_memoria ENABLE ROW LEVEL SECURITY;

-- Visible para DUEÑO/ADMIN/SUPER_USUARIO del tenant (mismo universo que ai_config_audit, mig 376).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_tenant_memoria' AND policyname = 'ai_tenant_memoria_select_dueno_admin'
  ) THEN
    CREATE POLICY ai_tenant_memoria_select_dueno_admin ON public.ai_tenant_memoria AS PERMISSIVE FOR SELECT TO authenticated
      USING (((tenant_id IN ( SELECT users.tenant_id
       FROM users
      WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
       FROM users
      WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
  END IF;
END $$;

-- Borrado manual desde Configuración — mismo universo que el SELECT. Sin policy de INSERT/UPDATE
-- a propósito: solo fn_ai_memoria_guardar (SECURITY DEFINER) escribe, un hecho nunca se edita
-- (se borra y, si corresponde, la IA lo vuelve a proponer distinto).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_tenant_memoria' AND policyname = 'ai_tenant_memoria_delete_dueno_admin'
  ) THEN
    CREATE POLICY ai_tenant_memoria_delete_dueno_admin ON public.ai_tenant_memoria AS PERMISSIVE FOR DELETE TO authenticated
      USING (((tenant_id IN ( SELECT users.tenant_id
       FROM users
      WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
       FROM users
      WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
  END IF;
END $$;

REVOKE ALL ON public.ai_tenant_memoria FROM anon;
GRANT SELECT, DELETE ON public.ai_tenant_memoria TO authenticated;
GRANT ALL ON public.ai_tenant_memoria TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_ai_memoria_guardar
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ai_memoria_guardar(p_hecho text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id();
  v_rol       text := public.get_user_role();
  v_hecho     text := trim(p_hecho);
  v_id        uuid;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol NOT IN ('DUEÑO', 'ADMIN') THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol DUEÑO o ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_hecho IS NULL OR v_hecho = '' THEN
    RAISE EXCEPTION 'El hecho a recordar no puede estar vacío';
  END IF;
  IF length(v_hecho) > 300 THEN
    RAISE EXCEPTION 'El hecho a recordar es demasiado largo (máximo 300 caracteres)';
  END IF;

  INSERT INTO public.ai_tenant_memoria (tenant_id, hecho, usuario_id)
  VALUES (v_tenant_id, v_hecho, auth.uid())
  RETURNING id INTO v_id;

  -- Tope de 20 hechos por tenant — se inyectan completos en cada prompt nuevo, así que la lista
  -- tiene que quedar acotada. Sin pg_cron disponible, se poda acá mismo en cada escritura.
  DELETE FROM public.ai_tenant_memoria
  WHERE tenant_id = v_tenant_id
    AND id NOT IN (
      SELECT id FROM public.ai_tenant_memoria
      WHERE tenant_id = v_tenant_id
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'hecho', v_hecho);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_memoria_guardar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_memoria_guardar(text) TO authenticated;
