-- Migration 372: Fase 4 (venta con pago combinado ARS+USD) del plan "Caja en USD" (relevamiento G5).
-- Continúa la Fase 3 (mig 371, ciclo operativo). Ver G360.Wiki/wiki/development/reglas-negocio.md
-- y el Artifact de la sesión (plan de 8 fases).
--
-- Esta fase es sobre todo código de aplicación (VentasPage.tsx: el cajero tipea USD, el sistema
-- reparte el efectivo cobrado entre la sesión ARS y la sesión USD correspondientes — D2/D3 del
-- relevamiento). Los campos que usa ya existen desde mig 368/370 (metodos_pago.moneda/es_efectivo,
-- productos.acepta_cualquier_moneda, ventas.cotizacion_usd) — no hace falta ningún cambio de
-- esquema para la funcionalidad en sí.
--
-- Lo único nuevo acá es una red de seguridad server-side (REGLA #0: guards además de la UI): con
-- Fase 4 activa, MUCHOS más lugares del código (VentasPage.tsx, no solo CajaPage.tsx) empiezan a
-- stampear `moneda` en cada `caja_movimientos`/`caja_arqueos` que insertan — más superficie, más
-- riesgo de que algún camino nuevo (o uno futuro) mande el valor equivocado. Este trigger no deja
-- que un movimiento quede con una moneda DISTINTA a la de su propia sesión — la sesión (mig 368,
-- denormalizada e inmutable al abrir) es la única fuente de verdad de en qué moneda opera.

CREATE OR REPLACE FUNCTION public.fn_validar_moneda_coincide_sesion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moneda_sesion text;
BEGIN
  SELECT moneda INTO v_moneda_sesion FROM caja_sesiones WHERE id = NEW.sesion_id;
  IF v_moneda_sesion IS NOT NULL AND COALESCE(NEW.moneda, 'ARS') IS DISTINCT FROM v_moneda_sesion THEN
    RAISE EXCEPTION 'La moneda del movimiento (%) no coincide con la moneda de la sesión de caja (%)', COALESCE(NEW.moneda, 'ARS'), v_moneda_sesion;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_moneda_movimiento ON caja_movimientos;
CREATE TRIGGER trg_validar_moneda_movimiento
  BEFORE INSERT OR UPDATE OF moneda, sesion_id ON caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_moneda_coincide_sesion();

DROP TRIGGER IF EXISTS trg_validar_moneda_arqueo ON caja_arqueos;
CREATE TRIGGER trg_validar_moneda_arqueo
  BEFORE INSERT OR UPDATE OF moneda, sesion_id ON caja_arqueos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_moneda_coincide_sesion();
