-- 462 — Armado de KIT: nada de stock fraccionario redondeado en silencio (REGLA #0, inventario)
--
-- inventario_lineas.cantidad / cantidad_reservada son INTEGER, pero kit_recetas.cantidad y kitting_log.cantidad_kits
-- son numeric(12,3). Armar 3 KITs con una receta de 0,5 reservaba y rebajaba 1,5 unidades → Postgres redondea al
-- asignar a integer → stock inventado o perdido sin aviso. La mig 459 lo cerró en el desarmado; esto lo cierra en el
-- ARMADO (manual `iniciar_armado_kit` y automático `fn_iniciar_armado_kit_auto`), que insertan el kitting_log al final
-- de su transacción: si este guard rechaza, se deshace todo (reservas incluidas).
-- Al 02/10 en PROD no hay recetas ni armados (0 filas): no hay datos afectados.

CREATE OR REPLACE FUNCTION public.fn_guard_kitting_cantidades_enteras()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
BEGIN
  IF NEW.cantidad_kits <> trunc(NEW.cantidad_kits) THEN
    RAISE EXCEPTION 'La cantidad de KITs tiene que ser un número entero' USING ERRCODE = 'check_violation';
  END IF;
  FOR rec IN SELECT r.cantidad, p.nombre FROM kit_recetas r JOIN productos p ON p.id = r.comp_producto_id
             WHERE r.tenant_id = NEW.tenant_id AND r.kit_producto_id = NEW.kit_producto_id LOOP
    IF rec.cantidad * NEW.cantidad_kits <> trunc(rec.cantidad * NEW.cantidad_kits) THEN
      RAISE EXCEPTION 'El componente "%" daría % unidades: el stock se lleva en unidades enteras. Elegí una cantidad de KITs que dé un número entero.',
        rec.nombre, trim_scale(rec.cantidad * NEW.cantidad_kits)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_kitting_cantidades_enteras() IS
  'Mig 462: un armado/desarmado de KIT no puede mover cantidades fraccionarias (el stock es entero).';

DROP TRIGGER IF EXISTS trg_kitting_log_cantidades_enteras ON public.kitting_log;
CREATE TRIGGER trg_kitting_log_cantidades_enteras
  BEFORE INSERT ON public.kitting_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_kitting_cantidades_enteras();
