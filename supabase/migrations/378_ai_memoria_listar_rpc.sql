-- Migration 378: Plan IA — Fase 3, fix de un hallazgo real de code-reviewer sobre la mig 377
-- (ai_tenant_memoria/fn_ai_memoria_guardar): la EF pretendía inyectar la memoria del negocio en
-- el prompt para CUALQUIER usuario que chatee (no solo DUEÑO/ADMIN — solo ESCRIBIR memoria está
-- restringido a esos roles), pero el fetch se hacía con la sesión real del usuario contra la
-- tabla directa, así que la policy SELECT de la mig 377 (DUEÑO/ADMIN/SUPER_USUARIO) devolvía []
-- en silencio para cualquier otro rol (CAJERO, DEPOSITO, SUPERVISOR, etc.) — el código no hacía
-- lo que su propio comentario decía.
--
-- Los hechos guardados son datos de negocio de baja sensibilidad (rubro, forma de operar —
-- nunca datos personales/sensibles ni fiscales, reforzado en la descripción del tool y en el
-- prompt), así que no hay motivo de REGLA #0 para restringir la LECTURA a un subconjunto de
-- roles del propio tenant — la escritura sigue exigiendo DUEÑO/ADMIN vía fn_ai_memoria_guardar
-- (sin cambios acá).
--
-- Mismo criterio que el resto del Plan IA: RPC SECURITY DEFINER que deriva tenant_id del JWT
-- (nunca un parámetro) en vez de relajar la policy de la tabla — la tabla sigue protegida por
-- RLS para cualquier acceso directo (ej. REST desde el cliente), solo esta función puntual
-- bypassea la restricción de ROL (no la de TENANT) para el caso de uso de "leer memoria propia
-- para personalizar el chat".
CREATE OR REPLACE FUNCTION public.fn_ai_memoria_listar()
 RETURNS TABLE(hecho text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;

  RETURN QUERY
  SELECT m.hecho
  FROM public.ai_tenant_memoria m
  WHERE m.tenant_id = v_tenant_id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 20;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ai_memoria_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ai_memoria_listar() TO authenticated;
