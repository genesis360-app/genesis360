-- 458 — No se puede eliminar (desactivar) una sucursal con stock activo o con una caja abierta
--
-- Incidente (2026-10-02, negocio de GO en PROD): la sucursal "Casa central" estaba desactivada con 28 líneas / 775
-- unidades adentro. El stock no se perdió, pero desapareció de Inventario y Productos: la app se para en la primera
-- sucursal ACTIVA y filtra por ella. "Eliminar sucursal" (SucursalesPage) es un borrado lógico (`activo = false`) que
-- no revisaba nada ni dejaba registro. REGLA #0 (inventario): el stock no puede quedar escondido en silencio.
--
-- Guard en la base (además del aviso en la pantalla): al pasar `activo` de true a false se rechaza si la sucursal tiene
-- líneas de stock activas con cantidad o una sesión de caja abierta. Para eliminarla primero se traslada el stock y se
-- cierra la caja. Aplica a todos los roles (incluido soporte por SQL: para forzarlo hay que vaciar la sucursal).

CREATE OR REPLACE FUNCTION public.fn_guard_baja_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_lineas   int;
  v_unidades numeric;
  v_cajas    int;
BEGIN
  IF NOT (OLD.activo IS TRUE AND NEW.activo IS NOT TRUE) THEN RETURN NEW; END IF;

  SELECT count(*), COALESCE(sum(cantidad), 0) INTO v_lineas, v_unidades
    FROM public.inventario_lineas
   WHERE sucursal_id = OLD.id AND activo AND cantidad > 0;
  IF v_lineas > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar la sucursal "%": tiene % unidades de stock en % líneas. Trasladá el stock a otra sucursal antes de eliminarla.',
      OLD.nombre, trim(to_char(v_unidades, 'FM999G999G990D###')), v_lineas
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_cajas
    FROM public.caja_sesiones s JOIN public.cajas c ON c.id = s.caja_id
   WHERE c.sucursal_id = OLD.id AND s.estado = 'abierta';
  IF v_cajas > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar la sucursal "%": tiene % caja(s) abierta(s). Cerralas antes de eliminarla.',
      OLD.nombre, v_cajas USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_baja_sucursal() IS
  'Mig 458: impide desactivar una sucursal con stock activo o caja abierta (el stock quedaba escondido de la vista).';

DROP TRIGGER IF EXISTS trg_sucursales_guard_baja ON public.sucursales;
CREATE TRIGGER trg_sucursales_guard_baja
  BEFORE UPDATE OF activo ON public.sucursales
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_baja_sucursal();
