-- 481 — Una ubicación con stock no puede pasar a OTRA sucursal (REGLA #0, inventario). Reporte de GO 2026-10-08 (El Tilo,
-- PROD): la ubicación "Escobar-Leandro" (sucursal Escobar - Canton) tenía 6 unidades de una línea de la sucursal "ELTILO
-- oficina" → el inventario de Escobar no la mostraba (filtra por la sucursal de la línea) pero el borrado de la ubicación sí
-- la encontraba. Origen: Configuración → editar ubicación cambia `sucursal_id` sin mirar el stock (y el historial solo
-- anotaba "nombre"). Ahora la base lo rechaza si la ubicación tiene stock activo de una sucursal distinta de la nueva.
-- Pasar una ubicación a "Global" (sucursal NULL) sigue permitido: sirve a todas las sucursales.

CREATE OR REPLACE FUNCTION public.fn_ubicacion_no_cambia_sucursal_con_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_suc   text;
  v_lpns  int;
BEGIN
  IF NEW.sucursal_id IS NOT DISTINCT FROM OLD.sucursal_id OR NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*), min(s.nombre) INTO v_lpns, v_suc
    FROM inventario_lineas l
    LEFT JOIN sucursales s ON s.id = l.sucursal_id
   WHERE l.ubicacion_id = NEW.id AND l.tenant_id = NEW.tenant_id
     AND l.activo AND l.cantidad > 0
     AND l.sucursal_id IS DISTINCT FROM NEW.sucursal_id;
  IF v_lpns > 0 THEN
    RAISE EXCEPTION 'La ubicación "%" tiene stock de la sucursal % (% LPN). Movelo o trasladalo antes de cambiarla de sucursal.',
      NEW.nombre, COALESCE(v_suc, 'sin sucursal'), v_lpns USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ubicacion_no_cambia_sucursal_con_stock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ubicacion_no_cambia_sucursal_con_stock ON public.ubicaciones;
CREATE TRIGGER trg_ubicacion_no_cambia_sucursal_con_stock BEFORE UPDATE OF sucursal_id ON public.ubicaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_ubicacion_no_cambia_sucursal_con_stock();
