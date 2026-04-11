-- Migration 035: avatar_url en users + bucket avatares
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Bucket 'avatares' (public, 2 MB, jpeg/png/webp)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Policies bucket avatares
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='avatares_public_read'
  ) THEN
    CREATE POLICY avatares_public_read ON storage.objects FOR SELECT USING (bucket_id = 'avatares');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='avatares_own_insert'
  ) THEN
    CREATE POLICY avatares_own_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='avatares_own_update'
  ) THEN
    CREATE POLICY avatares_own_update ON storage.objects FOR UPDATE
      USING (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='avatares_own_delete'
  ) THEN
    CREATE POLICY avatares_own_delete ON storage.objects FOR DELETE
      USING (bucket_id = 'avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;
