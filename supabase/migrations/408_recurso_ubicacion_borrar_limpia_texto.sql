-- 408 — Borrar una ubicación de recurso también limpia el texto del recurso
--
-- Correctivo de la 407, encontrado al probar el ciclo completo contra datos reales (crear →
-- vincular → renombrar → borrar) en vez de darlo por bueno porque compilaba.
--
-- El problema: `recursos.ubicacion_id` tiene `ON DELETE SET NULL`, así que al borrar la ubicación
-- el recurso perdía la FK **pero conservaba el texto huérfano** en `recursos.ubicacion`. Como la
-- pantalla arma la lista de ubicaciones disponibles sumando los textos sueltos (para no esconder
-- las ubicaciones de recursos viejos cargados a mano), esa ubicación **reaparecía agrupando
-- recursos aunque el usuario la acabara de borrar**.
--
-- Y lo más importante: el diálogo de borrado promete literalmente "N recursos quedarán sin
-- ubicación". Con el texto huérfano eso no era cierto. La pantalla no puede prometer una cosa y la
-- base hacer otra.
--
-- Va como trigger BEFORE DELETE y no como parte del `ON DELETE SET NULL` porque una FK solo puede
-- tocar la columna que referencia, no la de al lado.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recurso_ubicacion_borrar_limpia_texto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Se limpian los dos campos a la vez: el ON DELETE SET NULL de la FK se encarga de
  -- `ubicacion_id`, pero el texto quedaría colgado y la pantalla lo volvería a mostrar.
  UPDATE public.recursos
     SET ubicacion = NULL, ubicacion_id = NULL
   WHERE ubicacion_id = OLD.id;
  RETURN OLD;
END $$;

COMMENT ON FUNCTION public.fn_recurso_ubicacion_borrar_limpia_texto() IS
  'Al borrar una ubicacion del catalogo, los recursos quedan REALMENTE sin ubicacion (mig 408): '
  'sin esto el texto huerfano seguia agrupandolos en la pantalla, contradiciendo lo que el dialogo '
  'de borrado le promete al usuario.';

DROP TRIGGER IF EXISTS trg_recurso_ubicacion_borrar_limpia_texto ON public.recurso_ubicaciones;
CREATE TRIGGER trg_recurso_ubicacion_borrar_limpia_texto
  BEFORE DELETE ON public.recurso_ubicaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_recurso_ubicacion_borrar_limpia_texto();

COMMIT;
