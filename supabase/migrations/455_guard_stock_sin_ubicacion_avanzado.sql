-- 455 — U-2 (B), guard de la base: en modo AVANZADO no se crea stock sin ubicación
--
-- Decisión de GO (2026-10-01, A + B, sin ubicación sugerida): en avanzado el POS solo vende stock UBICADO, así que el
-- stock entra con la ubicación que elige la persona. La app ya lo exige en cada pantalla (ingreso individual y masivo,
-- recepción, traslado y su cancelación, KIT, importador, devolución, anulación de venta, editar LPN); este trigger es la
-- última línea de defensa para una pantalla vieja en caché o una llamada directa (REGLA #0: guard server-side además de
-- la UI).
--
-- Qué bloquea (solo roles del navegador: authenticated / anon; las funciones SECURITY DEFINER y service_role pasan):
--   · INSERT de una línea ACTIVA sin ubicación en un negocio avanzado;
--   · UPDATE que le QUITA la ubicación a una línea activa (OLD con ubicación → NEW sin ubicación);
--   · UPDATE que ACTIVA una línea sin ubicación (si no, "insertar inactiva y después activar" saltearía el guard).
--     Al 01/10 en PROD solo hay 3 líneas inactivas sin ubicación en negocios avanzados, todas de negocios de prueba.
-- Qué NO bloquea: las líneas viejas ACTIVAS que ya estaban sin ubicación se siguen pudiendo mover (vender, ajustar, desactivar),
-- y el modo básico no cambia (ahí el stock no se ubica). Las funciones INVOKER que crean stock (importador, armado de KIT,
-- reabastecimiento y des-pickeo WMS) quedan cubiertas: el importador ya rechaza la fila antes; el KIT exige la ubicación
-- al iniciar el armado (0 armados abiertos sin ubicación en PROD al 01/10); las tareas WMS siempre traen destino.

CREATE OR REPLACE FUNCTION public.fn_guard_stock_sin_ubicacion_avanzado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.ubicacion_id IS NOT NULL OR NEW.activo IS NOT TRUE THEN RETURN NEW; END IF;
  -- Línea vieja que YA estaba activa sin ubicación: se puede seguir moviendo (vender, ajustar).
  IF TG_OP = 'UPDATE' AND OLD.ubicacion_id IS NULL AND OLD.activo IS TRUE THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = NEW.tenant_id AND modo_operacion = 'avanzado') THEN
    RAISE EXCEPTION 'En modo avanzado el stock necesita una ubicación: elegí dónde quedó la mercadería (sin ubicación el punto de venta no la puede vender).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_stock_sin_ubicacion_avanzado() IS
  'U-2 (mig 455): en modo avanzado, authenticated/anon no crean stock activo sin ubicación ni se la quitan a una línea.';

DROP TRIGGER IF EXISTS trg_inventario_lineas_guard_ubicacion ON public.inventario_lineas;
CREATE TRIGGER trg_inventario_lineas_guard_ubicacion
  BEFORE INSERT OR UPDATE OF ubicacion_id, activo ON public.inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_stock_sin_ubicacion_avanzado();
