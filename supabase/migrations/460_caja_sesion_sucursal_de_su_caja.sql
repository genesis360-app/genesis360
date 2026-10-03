-- 460 — La sesión de caja vive en la sucursal de SU caja (REGLA #0, contable)
--
-- Incidente PROD 2026-10-02 (negocio de GO): una sesión abierta desde el 13/04 con $4.000 quedó con
-- sucursal_id = Huechuraba mientras su caja (`Caja1`) era de Casa central. Resultado: la sesión no aparecía en
-- ninguna pantalla de Caja (cada sucursal lista sus cajas) y el control "tenés una caja abierta en otra sucursal"
-- bloqueaba el cambio de sucursal sin salida. Se corrigió esa fila a mano (OK de GO); las 2 sesiones CERRADAS con el
-- mismo desfase quedan como están (REGLA #0 #7). Al 02/10 no hay otra sesión abierta desfasada en PROD.
--
-- Causas: (1) la app tomaba caja_sesiones.sucursal_id del selector de sucursal, no de la caja; (2) Configuración de
-- Caja deja mover una caja de sucursal aunque tenga una sesión abierta.
--
--   · BEFORE INSERT en caja_sesiones: si la caja tiene sucursal, la sesión toma ESA sucursal (la caja manda).
--   · BEFORE UPDATE OF sucursal_id en caja_sesiones: no se puede desalinear una sesión de su caja.
--   · BEFORE UPDATE OF sucursal_id en cajas: no se mueve de sucursal una caja con una sesión abierta.
-- Cajas sin sucursal (Caja Fuerte / "Sin sucursal"): sin cambios, la sesión conserva la sucursal que trae.

CREATE OR REPLACE FUNCTION public.fn_caja_sesion_sucursal_de_su_caja()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_suc uuid;
BEGIN
  SELECT sucursal_id INTO v_suc FROM cajas WHERE id = NEW.caja_id;
  IF v_suc IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.sucursal_id := v_suc;
  ELSIF NEW.sucursal_id IS DISTINCT FROM v_suc AND NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
    RAISE EXCEPTION 'La sesión de caja tiene que estar en la sucursal de su caja.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_sesiones_sucursal_de_su_caja ON public.caja_sesiones;
CREATE TRIGGER trg_caja_sesiones_sucursal_de_su_caja
  BEFORE INSERT OR UPDATE OF sucursal_id ON public.caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION public.fn_caja_sesion_sucursal_de_su_caja();

CREATE OR REPLACE FUNCTION public.fn_guard_mover_caja_con_sesion_abierta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     AND EXISTS (SELECT 1 FROM caja_sesiones WHERE caja_id = NEW.id AND estado = 'abierta') THEN
    RAISE EXCEPTION 'La caja "%" está abierta: cerrala antes de cambiarla de sucursal.', NEW.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cajas_guard_mover_con_sesion_abierta ON public.cajas;
CREATE TRIGGER trg_cajas_guard_mover_con_sesion_abierta
  BEFORE UPDATE OF sucursal_id ON public.cajas
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_mover_caja_con_sesion_abierta();

COMMENT ON FUNCTION public.fn_caja_sesion_sucursal_de_su_caja() IS
  'Mig 460: la sesión toma la sucursal de su caja al abrirse y no se puede desalinear después.';
COMMENT ON FUNCTION public.fn_guard_mover_caja_con_sesion_abierta() IS
  'Mig 460: no se cambia de sucursal una caja con una sesión abierta.';
