-- Migration 371: Fase 3 (ciclo operativo) del plan "Caja en USD" (relevamiento G5).
-- Continúa la Fase 2 (mig 370, permisos y configuración). Ver
-- G360.Wiki/wiki/development/reglas-negocio.md y el Artifact de la sesión (plan de 8 fases).
--
-- F1 del relevamiento: bloquear el traspaso entre cajas de distinta moneda — hoy (sin este guard)
-- se puede traspasar "100" de una caja ARS a una caja USD y acreditar 100 dólares directamente,
-- un bug de integridad latente. El código cliente (CajaPage.tsx: realizarTraspaso + el selector del
-- modal) ya filtra/valida esto, pero REGLA #0 pide guard server-side ADEMÁS de la UI — la tabla
-- caja_traspasos es el único lugar que conoce las 2 sesiones (origen y destino) de un mismo
-- traspaso, así que es donde corresponde el trigger.

CREATE OR REPLACE FUNCTION public.fn_validar_traspaso_misma_moneda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moneda_origen  text;
  v_moneda_destino text;
BEGIN
  SELECT moneda INTO v_moneda_origen  FROM caja_sesiones WHERE id = NEW.sesion_origen_id;
  SELECT moneda INTO v_moneda_destino FROM caja_sesiones WHERE id = NEW.sesion_destino_id;
  IF COALESCE(v_moneda_origen, 'ARS') IS DISTINCT FROM COALESCE(v_moneda_destino, 'ARS') THEN
    RAISE EXCEPTION 'No se puede traspasar entre cajas de distinta moneda (% -> %)', v_moneda_origen, v_moneda_destino;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_traspaso_misma_moneda ON caja_traspasos;
CREATE TRIGGER trg_validar_traspaso_misma_moneda
  BEFORE INSERT ON caja_traspasos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_traspaso_misma_moneda();

-- I1 del relevamiento: quién puede operar una Caja USD, configurable por tenant (mig 370,
-- tenants.caja_usd_roles_permitidos). El cliente (CajaPage.tsx: cajasOperativas) ya filtra la caja
-- del picker para un rol sin permiso, pero eso es solo UI — sin este guard, cualquiera podría abrir
-- una sesión en una caja USD igual insertando directo. DUEÑO siempre puede (no requiere estar en la
-- lista) — mismo criterio "aditivo" que cotizacion_usd_roles_permitidos.
CREATE OR REPLACE FUNCTION public.fn_validar_rol_opera_caja_usd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moneda_caja text;
  v_rol         text;
  v_rol_custom  uuid;
  v_roles_ok    jsonb;
BEGIN
  SELECT moneda INTO v_moneda_caja FROM cajas WHERE id = NEW.caja_id;
  IF COALESCE(v_moneda_caja, 'ARS') <> 'USD' THEN
    RETURN NEW;
  END IF;

  -- Quien efectivamente abre la sesión (abierta_por, A2) es a quien se le exige el permiso —
  -- mismo actor que valida el cliente con el rol logueado.
  SELECT rol, rol_custom_id INTO v_rol, v_rol_custom
  FROM users WHERE id = COALESCE(NEW.abierta_por, NEW.usuario_id);

  IF v_rol = 'DUEÑO' THEN
    RETURN NEW;
  END IF;

  SELECT caja_usd_roles_permitidos INTO v_roles_ok FROM tenants WHERE id = NEW.tenant_id;
  IF v_roles_ok IS NOT NULL
     AND (v_roles_ok ? v_rol OR (v_rol_custom IS NOT NULL AND v_roles_ok ? ('custom:' || v_rol_custom::text)))
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Tu rol no tiene permiso para operar una Caja USD';
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_rol_opera_caja_usd ON caja_sesiones;
CREATE TRIGGER trg_validar_rol_opera_caja_usd
  BEFORE INSERT ON caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION fn_validar_rol_opera_caja_usd();
