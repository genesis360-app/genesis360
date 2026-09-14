-- 418 — Dropear `recursos.ubicacion` (texto libre): la ubicación de un recurso es `ubicacion_id`
--
-- Historia:
--   · Mig 102: `recursos.ubicacion` era texto libre.
--   · Mig 407: catálogo `recurso_ubicaciones` + `recursos.ubicacion_id`, con el texto como espejo de
--     solo lectura sincronizado por triggers. Pero `RecursosPage` nunca pasó a escribir el id: seguía
--     guardando el texto. Editar la ubicación de un recurso que ya tenía FK cambiaba el texto y no el
--     id, así que renombrar o borrar la ubicación vieja le pisaba el cambio.
--   · 2026-09-14: `RecursosPage` guarda `ubicacion_id` y crea las ubicaciones nuevas en el catálogo
--     (mig 417 define quién puede). Esta migración va DESPUÉS de ese frontend en PROD.
--
-- Verificado antes de escribir esto (2026-09-14): PROD 0 recursos; DEV 6 recursos con texto, todos con
-- FK y texto igual al nombre del catálogo. Lectores del texto en el código: `RecursosPage` y
-- `DashInventarioArea` — los dos cambiados en el mismo release.
--
-- 🛑 ORDEN DE DEPLOY: frontend nuevo en PROD primero. Con el frontend viejo, `DashInventarioArea`
-- pide `ubicacion` en el select y PostgREST respondería 400.

-- 1) Backfill por las dudas: textos sueltos sin FK pasan al catálogo y se enlazan.
INSERT INTO public.recurso_ubicaciones (tenant_id, nombre)
SELECT DISTINCT r.tenant_id, btrim(r.ubicacion)
FROM public.recursos r
WHERE r.ubicacion_id IS NULL AND btrim(coalesce(r.ubicacion, '')) <> ''
ON CONFLICT (tenant_id, nombre) DO NOTHING;

UPDATE public.recursos r
   SET ubicacion_id = u.id
  FROM public.recurso_ubicaciones u
 WHERE r.ubicacion_id IS NULL
   AND u.tenant_id = r.tenant_id
   AND u.nombre = btrim(r.ubicacion);

-- Guard: nada con texto puede quedar sin FK.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recursos WHERE ubicacion_id IS NULL AND btrim(coalesce(ubicacion, '')) <> '') THEN
    RAISE EXCEPTION 'mig 418: quedaron recursos con ubicación en texto y sin ubicacion_id';
  END IF;
END $$;

-- 2) Los tres triggers que escribían el texto (migs 407 y 408). Sin la columna fallarían en runtime.
--    `ON DELETE SET NULL` de la FK ya cubre lo que hacía el de borrado con `ubicacion_id`.
DROP TRIGGER IF EXISTS trg_recursos_sync_ubicacion_texto ON public.recursos;
DROP TRIGGER IF EXISTS trg_recurso_ubicacion_propagar_nombre ON public.recurso_ubicaciones;
DROP TRIGGER IF EXISTS trg_recurso_ubicacion_borrar_limpia_texto ON public.recurso_ubicaciones;
DROP FUNCTION IF EXISTS public.fn_recursos_sync_ubicacion_texto();
DROP FUNCTION IF EXISTS public.fn_recurso_ubicacion_propagar_nombre();
DROP FUNCTION IF EXISTS public.fn_recurso_ubicacion_borrar_limpia_texto();

-- 3) La columna.
ALTER TABLE public.recursos DROP COLUMN IF EXISTS ubicacion;

COMMENT ON COLUMN public.recursos.ubicacion_id IS
  'Ubicación del recurso: FK al catálogo recurso_ubicaciones. El texto libre `ubicacion` se dropeó (mig 418).';
