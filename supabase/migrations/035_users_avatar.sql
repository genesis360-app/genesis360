-- Migration 035: avatar_url en users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Nota: crear bucket 'avatares' en Supabase Storage Dashboard
--   - Tipo: PUBLIC
--   - Tamaño máximo: 2 MB
--   - MIME permitidos: image/jpeg, image/png, image/webp
--
-- Policy (ejecutar después de crear el bucket):
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Avatar público para leer"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatares');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Avatar propio para subir'
  ) THEN
    CREATE POLICY "Avatar propio para subir"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Avatar propio para actualizar'
  ) THEN
    CREATE POLICY "Avatar propio para actualizar"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Avatar propio para eliminar'
  ) THEN
    CREATE POLICY "Avatar propio para eliminar"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;
