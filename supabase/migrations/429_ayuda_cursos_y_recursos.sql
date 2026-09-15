-- 429 — Ayuda, fase 2: "Cursos y recursos"
--
-- Decisión de GO (2026-09-15): construir la sección ya, vacía, y que muestre solo los videos que él publique. Los videos
-- de onboarding siguen en pausa hasta que los revise con su socio, así que no se siembra ninguno.
--
-- Cómo se publica un video (sin tocar código):
--   1) Supabase → Storage → bucket `ayuda-recursos` → subir el archivo (mp4/webm hasta 50 MB; miniatura opcional).
--   2) Table Editor → `ayuda_recursos` → fila nueva con `titulo`, `video_path` (la ruta dentro del bucket, ej.
--      `onboarding/video1-final.mp4`), opcionales `descripcion`, `modulo` (la ruta de la app donde se sugiere primero,
--      ej. `/ventas`), `miniatura_path`, `duracion_seg`, `orden`, y `publicado = true`.
-- Hasta que `publicado` sea true la app no la muestra. Los usuarios de la app solo leen: se escribe desde el dashboard.

CREATE TABLE IF NOT EXISTS public.ayuda_recursos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 120),
  descripcion     text,
  modulo          text,
  video_path      text NOT NULL CHECK (length(btrim(video_path)) > 0),
  miniatura_path  text,
  duracion_seg    integer CHECK (duracion_seg IS NULL OR duracion_seg > 0),
  orden           integer NOT NULL DEFAULT 100,
  publicado       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ayuda_recursos IS
  'Videos de Ayuda → Cursos y recursos. Se cargan desde el dashboard (archivo en el bucket ayuda-recursos + fila acá con publicado = true). Mig 429.';
COMMENT ON COLUMN public.ayuda_recursos.video_path IS 'Ruta del archivo dentro del bucket público ayuda-recursos.';
COMMENT ON COLUMN public.ayuda_recursos.modulo IS 'Ruta de la app donde se sugiere primero (ej. /ventas). NULL = general.';

CREATE INDEX IF NOT EXISTS idx_ayuda_recursos_publicados
  ON public.ayuda_recursos (orden, created_at) WHERE publicado;

ALTER TABLE public.ayuda_recursos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ayuda_recursos_select ON public.ayuda_recursos;
CREATE POLICY ayuda_recursos_select ON public.ayuda_recursos FOR SELECT TO authenticated
  USING (publicado);

REVOKE ALL ON public.ayuda_recursos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ayuda_recursos FROM authenticated;
GRANT SELECT ON public.ayuda_recursos TO authenticated;

-- Bucket público: el contenido es material de ayuda, se sirve por URL pública (sin policies de lectura). Nadie sube desde
-- la app (no hay policy de INSERT); se carga desde el dashboard.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ayuda-recursos', 'ayuda-recursos', true, 52428800,
        ARRAY['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
