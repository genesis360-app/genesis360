-- 233 — Clave maestra: hashear (bcrypt) en vez de texto plano + setter server-side con guard.
--
-- Contexto (REGLA #0 — control/seguridad): la `clave_maestra` del tenant protege acciones
-- patrimoniales (anular ventas/movimientos, abrir caja con diferencia, cerrar caja ajena,
-- dar de baja deuda incobrable, pago de OC/courier sobre umbral). Hasta acá se guardaba en
-- TEXTO PLANO en `tenants.clave_maestra` y se comparaba directo en `verificar_clave_maestra`,
-- y además viajaba al cliente dentro del objeto tenant. Esta migración:
--   1) Hashea con bcrypt las claves existentes (preservando el VALOR — la misma clave sigue
--      verificando; no es reescritura de historial fiscal, es endurecimiento del credencial).
--   2) Reescribe `verificar_clave_maestra` para comparar contra el hash (extensions.crypt).
--   3) Agrega `set_clave_maestra(p_clave)` (SECURITY DEFINER): solo el DUEÑO del tenant la cambia,
--      mínimo 6 caracteres, hashea server-side. El frontend deja de escribir `clave_maestra` directo.
--
-- pgcrypto ya está disponible en el schema `extensions` (crypt/gen_salt).

-- 1) Backfill: hashear las claves que todavía están en texto plano (los hash bcrypt empiezan con "$2").
UPDATE public.tenants
   SET clave_maestra = extensions.crypt(clave_maestra, extensions.gen_salt('bf'))
 WHERE clave_maestra IS NOT NULL
   AND length(trim(clave_maestra)) > 0
   AND clave_maestra NOT LIKE '$2%';

-- 2) Verificación por hash (mantiene el contrato: NULL/vacía → TRUE = "no requiere clave").
CREATE OR REPLACE FUNCTION public.verificar_clave_maestra(p_tenant_id uuid, p_clave text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave_real TEXT;
BEGIN
  SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = p_tenant_id;
  IF v_clave_real IS NULL OR LENGTH(TRIM(v_clave_real)) = 0 THEN
    RETURN TRUE;
  END IF;
  IF p_clave IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Compat: si por algún motivo quedó una clave en texto plano (no bcrypt), comparar directo.
  IF v_clave_real NOT LIKE '$2%' THEN
    RETURN v_clave_real = p_clave;
  END IF;
  RETURN v_clave_real = extensions.crypt(p_clave, v_clave_real);
END $function$;

-- 3) Setter server-side: solo DUEÑO del tenant, mínimo 6 caracteres, hashea.
CREATE OR REPLACE FUNCTION public.set_clave_maestra(p_clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid;
  v_role   text;
BEGIN
  v_tenant := public.get_user_tenant_id();
  v_role   := public.get_user_role();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en la sesión';
  END IF;
  IF v_role IS DISTINCT FROM 'DUEÑO' THEN
    RAISE EXCEPTION 'Solo el DUEÑO puede cambiar la clave maestra';
  END IF;
  IF p_clave IS NULL OR length(trim(p_clave)) < 6 THEN
    RAISE EXCEPTION 'La clave maestra debe tener al menos 6 caracteres';
  END IF;
  UPDATE public.tenants
     SET clave_maestra = extensions.crypt(trim(p_clave), extensions.gen_salt('bf'))
   WHERE id = v_tenant;
END $function$;

REVOKE ALL ON FUNCTION public.set_clave_maestra(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_clave_maestra(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_clave_maestra(uuid, text) TO authenticated;
