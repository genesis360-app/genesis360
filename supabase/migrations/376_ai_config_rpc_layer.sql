-- Migration 376: capa de RPCs para que el Asistente IA pueda proponer/aplicar cambios de
-- configuración con confirmación previa (plan IA — Fase 2, relevamiento respondido por GO
-- 2026-08-20: alcance "todo lo NO fiscal", empezar la capa de RPCs ya). Ver
-- G360.Wiki/wiki/development/reglas-negocio.md y el Artifact de la propuesta.
--
-- Diseño (REGLA #0 — guard server-side, nunca UPDATE libre desde el cliente ni desde la IA):
-- 3 RPCs, una por tipo de dato (boolean/integer/text) — evita casteos dinámicos ambiguos de un
-- único RPC "genérico" que acepte cualquier tipo. Cada una:
--   1. Deriva tenant_id y rol del JWT del usuario que llama (get_user_tenant_id()/get_user_role())
--      — NUNCA recibe tenant_id como parámetro, así no hay forma de apuntar a otro tenant aunque
--      el caller mienta. Se llama CON la sesión del usuario (no service_role), preservando su
--      identidad real — mismo criterio de seguridad que cualquier RPC del resto del sistema.
--   2. Exige rol DUEÑO o ADMIN (mismo umbral que el resto de Configuración).
--   3. Valida el campo contra un ALLOWLIST fijo hardcodeado en el cuerpo de la función — un campo
--      que no está en la lista es RECHAZADO, punto. Ampliar la lista es SIEMPRE una migración
--      nueva (auditable en git), nunca una fila editable en una tabla. Ningún campo fiscal/AFIP
--      (cuit, condicion_iva_emisor, afip_*, cbu, clave_maestra, etc.) está ni va a estar acá salvo
--      decisión explícita de GO — el punto de partida son 6 campos operativos NO fiscales que ya
--      tienen su propio handler granular de 1-campo en ConfigPage.tsx (mismo patrón, replicado
--      server-side): wms_reabastecimiento_on_demand/umbral, pedido_manual_habilitado,
--      pedido_cierre_automatico, repositor_etiquetas_por_hoja, pedido_numeracion.
--   4. Escribe en ai_config_audit (quién, qué campo, valor anterior/nuevo, por qué) — trazabilidad
--      de cualquier cambio que la IA aplique, visible para el DUEÑO/ADMIN desde Configuración.
--
-- Esto es SOLO la capa de backend — todavía NO hay ningún caller (ni la EF ai-assistant ni el
-- frontend invocan estas RPCs todavía). Wiring real (tool-calling de la IA + tarjeta de
-- confirmación en el chat) queda para una sesión posterior, a propósito, para poder revisar esta
-- capa de forma aislada primero.

CREATE TABLE IF NOT EXISTS public.ai_config_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campo text NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  razon text,
  usuario_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_config_audit_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_ai_config_audit_tenant ON public.ai_config_audit USING btree (tenant_id, created_at DESC);

ALTER TABLE public.ai_config_audit ENABLE ROW LEVEL SECURITY;

-- Visible para DUEÑO/ADMIN/SUPER_USUARIO del tenant (mismo universo que boveda_conversiones_usd,
-- mig 373) — sin policy de INSERT/UPDATE/DELETE a propósito: solo las RPCs (SECURITY DEFINER)
-- escriben acá, nunca un cliente directo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_config_audit' AND policyname = 'ai_config_audit_select_dueno_admin'
  ) THEN
    CREATE POLICY ai_config_audit_select_dueno_admin ON public.ai_config_audit AS PERMISSIVE FOR SELECT TO authenticated
      USING (((tenant_id IN ( SELECT users.tenant_id
       FROM users
      WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (EXISTS ( SELECT 1
       FROM users
      WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.rol = ANY (ARRAY['DUEÑO'::text, 'ADMIN'::text, 'SUPER_USUARIO'::text])))))));
  END IF;
END $$;

REVOKE ALL ON public.ai_config_audit FROM anon;
GRANT SELECT ON public.ai_config_audit TO authenticated;
GRANT ALL ON public.ai_config_audit TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_ai_config_set_bool
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ai_config_set_bool(p_campo text, p_valor boolean, p_razon text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id();
  v_rol       text := public.get_user_role();
  v_allowlist text[] := ARRAY[
    'wms_reabastecimiento_on_demand',
    'wms_reabastecimiento_umbral',
    'pedido_manual_habilitado',
    'pedido_cierre_automatico'
  ];
  v_anterior boolean;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol NOT IN ('DUEÑO', 'ADMIN') THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol DUEÑO o ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_campo = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Campo "%" no habilitado para que la IA lo modifique', p_campo USING ERRCODE = 'insufficient_privilege';
  END IF;

  EXECUTE format('SELECT %I FROM tenants WHERE id = $1', p_campo) INTO v_anterior USING v_tenant_id;
  EXECUTE format('UPDATE tenants SET %I = $1 WHERE id = $2', p_campo) USING p_valor, v_tenant_id;

  INSERT INTO public.ai_config_audit (tenant_id, campo, valor_anterior, valor_nuevo, razon, usuario_id)
  VALUES (v_tenant_id, p_campo, v_anterior::text, p_valor::text, p_razon, auth.uid());

  RETURN jsonb_build_object('ok', true, 'campo', p_campo, 'valor_anterior', v_anterior, 'valor_nuevo', p_valor);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_config_set_bool(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_config_set_bool(text, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_ai_config_set_int
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ai_config_set_int(p_campo text, p_valor integer, p_razon text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id();
  v_rol       text := public.get_user_role();
  v_allowlist text[] := ARRAY[
    'repositor_etiquetas_por_hoja'
  ];
  v_anterior integer;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol NOT IN ('DUEÑO', 'ADMIN') THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol DUEÑO o ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_campo = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Campo "%" no habilitado para que la IA lo modifique', p_campo USING ERRCODE = 'insufficient_privilege';
  END IF;

  EXECUTE format('SELECT %I FROM tenants WHERE id = $1', p_campo) INTO v_anterior USING v_tenant_id;
  EXECUTE format('UPDATE tenants SET %I = $1 WHERE id = $2', p_campo) USING p_valor, v_tenant_id;

  INSERT INTO public.ai_config_audit (tenant_id, campo, valor_anterior, valor_nuevo, razon, usuario_id)
  VALUES (v_tenant_id, p_campo, v_anterior::text, p_valor::text, p_razon, auth.uid());

  RETURN jsonb_build_object('ok', true, 'campo', p_campo, 'valor_anterior', v_anterior, 'valor_nuevo', p_valor);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_config_set_int(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_config_set_int(text, integer, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_ai_config_set_text
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ai_config_set_text(p_campo text, p_valor text, p_razon text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id();
  v_rol       text := public.get_user_role();
  v_allowlist text[] := ARRAY[
    'pedido_numeracion'
  ];
  v_anterior text;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol NOT IN ('DUEÑO', 'ADMIN') THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol DUEÑO o ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_campo = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Campo "%" no habilitado para que la IA lo modifique', p_campo USING ERRCODE = 'insufficient_privilege';
  END IF;

  EXECUTE format('SELECT %I FROM tenants WHERE id = $1', p_campo) INTO v_anterior USING v_tenant_id;
  EXECUTE format('UPDATE tenants SET %I = $1 WHERE id = $2', p_campo) USING p_valor, v_tenant_id;

  INSERT INTO public.ai_config_audit (tenant_id, campo, valor_anterior, valor_nuevo, razon, usuario_id)
  VALUES (v_tenant_id, p_campo, v_anterior, p_valor, p_razon, auth.uid());

  RETURN jsonb_build_object('ok', true, 'campo', p_campo, 'valor_anterior', v_anterior, 'valor_nuevo', p_valor);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_config_set_text(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_config_set_text(text, text, text) TO authenticated;
