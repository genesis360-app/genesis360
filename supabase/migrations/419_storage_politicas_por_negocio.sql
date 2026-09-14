-- 419 — Archivos de RRHH, Envíos y presupuestos de servicios: políticas por negocio (y quién ve RRHH)
--
-- Hallazgo (2026-09-14, paridad DEV↔PROD): `public` y `cron` estaban idénticos, `storage` no.
--   · PROD no tenía NINGUNA política para los buckets `empleados`, `etiquetas-envios` y
--     `presupuestos-servicios` (las migs 022/073/075 no las dejaron ahí) → subir o leer esos archivos
--     fallaba: documentos/préstamos/recibos de RRHH, firma, fotos de entrega y facturas de courier,
--     presupuestos de servicios. Sin datos perdidos: PROD tenía 0 envíos, 0 documentos, 0 presupuestos.
--   · Las de DEV no se podían copiar:
--       - `etiquetas-envios` y `presupuestos-servicios` con `auth.uid() IS NOT NULL` → cualquier usuario
--         de OTRO negocio leía (y en presupuestos borraba) archivos ajenos conociendo la ruta.
--       - `empleados` solo matcheaba `<empleado_id>/…`; `prestamos/<empleado_id>/…` y
--         `recibos/<empleado_id>/…` fallaban también en DEV.
--
-- Decisiones de GO (2026-09-14):
--   > archivos de RRHH: "solo quien maneja RRHH y el propio empleado desde Mi Portal. Y obviamente el
--   >  dueño y algún custom role si es que se lo permiten en el rol."
--   > transportista sube foto y firma desde su link: "si" → Edge Function `transportista-subir-archivo`
--     (valida el token y sube con service_role; esta migración no le da nada a `anon`).
--
-- Rutas reales, verificadas en el código antes de escribir esto:
--   empleados:               <empleado_id>/…  ·  prestamos/<empleado_id>/…  ·  recibos/<empleado_id>/…
--   etiquetas-envios:        pod/<envio_id>/…  ·  facturas-courier/<tenant_id>/…
--   presupuestos-servicios:  <tenant_id>/…
--
-- 🛑 Las funciones auxiliares devuelven SOLO booleanos. Una primera versión devolvía la fila de
-- `empleados`, y como se ejecutan como SECURITY DEFINER eso habría dejado a cualquier usuario del
-- negocio leer sueldos y CBU llamándolas por RPC, salteando la RLS de la tabla.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Quién maneja RRHH
--    Mismo criterio que `auth_puede_editar_modulo` (migs 396/404/405): el permiso EXPLÍCITO del rol
--    custom manda; si no hay, DUEÑO / SUPER_USUARIO / ADMIN y el rol fijo RRHH. Para LEER alcanza con
--    'ver'; para escribir, 'editar' o 'supervisa'. Sin sesión (service_role, Edge Functions) → true.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_puede_acceder_rrhh(p_escritura boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rol  text;
  v_perm text;
BEGIN
  IF v_uid IS NULL THEN RETURN true; END IF;

  SELECT u.rol, rc.permisos ->> 'rrhh'
    INTO v_rol, v_perm
  FROM public.users u
  LEFT JOIN public.roles_custom rc ON rc.id = u.rol_custom_id AND rc.activo = true
  WHERE u.id = v_uid;

  IF v_rol IS NULL THEN RETURN false; END IF;

  IF v_perm IS NOT NULL THEN
    RETURN CASE WHEN p_escritura THEN v_perm IN ('editar', 'supervisa')
                ELSE v_perm IN ('ver', 'editar', 'supervisa') END;
  END IF;

  IF v_rol = 'VIEWER' THEN RETURN false; END IF;
  RETURN v_rol IN ('DUEÑO', 'SUPER_USUARIO', 'ADMIN', 'RRHH');
END $$;

REVOKE ALL ON FUNCTION public.auth_puede_acceder_rrhh(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_puede_acceder_rrhh(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_puede_acceder_rrhh(boolean) IS
  'Maneja RRHH (mig 419): permiso explícito del rol custom (ver para leer; editar/supervisa para escribir) '
  'o DUEÑO/SUPER_USUARIO/ADMIN/RRHH. Decisión de GO 2026-09-14.';

-- ¿Puede este usuario leer (p_escritura = false) o escribir (true) este archivo del bucket `empleados`?
-- El empleado sale de la ruta y tiene que ser del negocio del usuario. Lee quien maneja RRHH o el
-- propio empleado (Mi Portal); escribe solo quien maneja RRHH.
CREATE OR REPLACE FUNCTION public.storage_puede_archivo_empleado(p_name text, p_escritura boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_carpetas text[] := storage.foldername(p_name);
  v_empleado text;
  v_user_id  uuid;
BEGIN
  v_empleado := CASE WHEN v_carpetas[1] IN ('prestamos', 'recibos') THEN v_carpetas[2] ELSE v_carpetas[1] END;
  IF v_empleado IS NULL THEN RETURN false; END IF;

  SELECT e.user_id INTO v_user_id
  FROM public.empleados e
  WHERE e.id::text = v_empleado AND e.tenant_id = public.get_user_tenant_id();
  IF NOT FOUND THEN RETURN false; END IF;

  IF public.auth_puede_acceder_rrhh(p_escritura) THEN RETURN true; END IF;
  RETURN NOT p_escritura AND v_user_id IS NOT NULL AND v_user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.storage_puede_archivo_empleado(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_puede_archivo_empleado(text, boolean) TO authenticated, service_role;

-- ¿La ruta del bucket `etiquetas-envios` es del negocio del usuario?
CREATE OR REPLACE FUNCTION public.storage_ruta_envio_es_del_negocio(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE (storage.foldername(p_name))[1]
    WHEN 'pod' THEN EXISTS (
      SELECT 1 FROM public.envios e
      WHERE e.id::text = (storage.foldername(p_name))[2]
        AND e.tenant_id = public.get_user_tenant_id()
    )
    WHEN 'facturas-courier' THEN (storage.foldername(p_name))[2] = public.get_user_tenant_id()::text
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.storage_ruta_envio_es_del_negocio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_ruta_envio_es_del_negocio(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) Fuera las políticas viejas (DEV las tiene; PROD no)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS empleados_bucket_select ON storage.objects;
DROP POLICY IF EXISTS empleados_bucket_insert ON storage.objects;
DROP POLICY IF EXISTS empleados_bucket_delete ON storage.objects;
DROP POLICY IF EXISTS etiq_envio_read ON storage.objects;
DROP POLICY IF EXISTS etiq_envio_insert ON storage.objects;
DROP POLICY IF EXISTS presup_serv_read ON storage.objects;
DROP POLICY IF EXISTS presup_serv_insert ON storage.objects;
DROP POLICY IF EXISTS presup_serv_delete ON storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) `empleados` — RRHH ve y escribe; el empleado ve lo suyo (Mi Portal)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE POLICY empleados_archivos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'empleados' AND public.storage_puede_archivo_empleado(name, false));
CREATE POLICY empleados_archivos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'empleados' AND public.storage_puede_archivo_empleado(name, true));
CREATE POLICY empleados_archivos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'empleados' AND public.storage_puede_archivo_empleado(name, true))
  WITH CHECK (bucket_id = 'empleados' AND public.storage_puede_archivo_empleado(name, true));
CREATE POLICY empleados_archivos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'empleados' AND public.storage_puede_archivo_empleado(name, true));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) `etiquetas-envios` — pod/<envio_id>/… de un envío del negocio, o facturas-courier/<tenant_id>/…
--    El transportista (sin sesión) sube por la Edge Function `transportista-subir-archivo`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE POLICY envios_archivos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'etiquetas-envios' AND public.storage_ruta_envio_es_del_negocio(name));
CREATE POLICY envios_archivos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'etiquetas-envios' AND public.storage_ruta_envio_es_del_negocio(name));
CREATE POLICY envios_archivos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'etiquetas-envios' AND public.storage_ruta_envio_es_del_negocio(name))
  WITH CHECK (bucket_id = 'etiquetas-envios' AND public.storage_ruta_envio_es_del_negocio(name));
CREATE POLICY envios_archivos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'etiquetas-envios' AND public.storage_ruta_envio_es_del_negocio(name));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) `presupuestos-servicios` — <tenant_id>/…
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE POLICY presupuestos_servicios_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'presupuestos-servicios' AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text);
CREATE POLICY presupuestos_servicios_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'presupuestos-servicios' AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text);
CREATE POLICY presupuestos_servicios_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'presupuestos-servicios' AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'presupuestos-servicios' AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text);
CREATE POLICY presupuestos_servicios_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'presupuestos-servicios' AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text);
