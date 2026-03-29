-- Migration 027: Seguridad del bucket 'productos'
--
-- Problemas corregidos:
--   1. DELETE policy solo verificaba auth.uid() IS NOT NULL — sin restricción de tenant.
--      Ahora verifica que el primer segmento del path coincida con el tenant_id del usuario.
--   2. Agrega file_size_limit de 5 MB al bucket.
--   3. Agrega allowed_mime_types: solo image/jpeg, image/png, image/webp.
--
-- Path en el bucket: {tenant_id}/{timestamp}.{ext}
-- La función storage.foldername(name) devuelve array de segmentos del path.

-- 1. Reemplazar la política DELETE permisiva por una con verificación de tenant
DROP POLICY IF EXISTS delete_productos ON storage.objects;

DO $$ BEGIN
  CREATE POLICY delete_productos ON storage.objects
    FOR DELETE USING (
      bucket_id = 'productos'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM users WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Aplicar file_size_limit (5 MB) y allowed_mime_types al bucket
UPDATE storage.buckets
SET
  file_size_limit   = 5242880,  -- 5 * 1024 * 1024
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'productos';
