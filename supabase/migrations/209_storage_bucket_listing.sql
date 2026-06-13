-- Migration 209: Cerrar listado cross-tenant de buckets públicos (auditoría pre-cliente)
--
-- Hallazgo get_advisors(security) `public_bucket_allows_listing`: los buckets públicos
-- `avatares` y `productos` tenían una policy SELECT AMPLIA (`*_authenticated_read`,
-- qual solo `bucket_id = '...'`) que permitía a CUALQUIER usuario autenticado LISTAR
-- todos los archivos de TODOS los tenants (enumeración cross-tenant).
--
-- La app NO lista estos buckets: solo `upload` + `getPublicUrl` (MiCuentaPage avatares,
-- ProductoFormPage productos). `getPublicUrl` no consulta storage.objects (el bucket es
-- público → CDN sirve por URL). Por eso reemplazamos el SELECT amplio por uno
-- SCOPEADO a la propia carpeta (least privilege): avatares bajo `{user_id}/...`,
-- productos bajo `{tenant_id}/...` (coincide con las policies own_insert/delete).
-- Resultado: se mantiene la visualización por URL pública y el poder leer los propios
-- archivos, pero se corta la enumeración cross-tenant. Idempotente.

-- avatares: solo los propios (carpeta = user_id)
DROP POLICY IF EXISTS avatares_authenticated_read ON storage.objects;
CREATE POLICY avatares_authenticated_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatares'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- productos: solo los del propio tenant (carpeta = tenant_id)
DROP POLICY IF EXISTS productos_authenticated_read ON storage.objects;
CREATE POLICY productos_authenticated_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'productos'
    AND (storage.foldername(name))[1] IN (
      SELECT (users.tenant_id)::text FROM users WHERE users.id = auth.uid()
    )
  );
