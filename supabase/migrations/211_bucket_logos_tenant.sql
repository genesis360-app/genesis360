-- Migration 211: Bucket `logos` para el logo del negocio (factura + presupuesto)
--
-- El tenant sube su logo en Config → Facturación; se embebe en el PDF de factura y
-- presupuesto (paridad con Xubio). `tenants.logo_url` ya existe (mig 001) — acá solo
-- creamos el bucket de almacenamiento y sus policies, scopeadas por carpeta de tenant
-- (mismo patrón que `productos`, mig 209: evita enumeración cross-tenant).
--
-- Bucket público: el PDF se genera en el cliente y embebe la imagen vía la URL pública
-- (getPublicUrl → CDN, no consulta storage.objects). La SELECT scopeada igual corta el
-- listado cross-tenant para el advisor. Path: `{tenant_id}/logo.{ext}`. Idempotente.

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Lectura: solo los del propio tenant (carpeta = tenant_id). La visualización en el PDF
-- usa la URL pública (CDN), que no pasa por esta policy.
DROP POLICY IF EXISTS logos_tenant_read ON storage.objects;
CREATE POLICY logos_tenant_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT (users.tenant_id)::text FROM users WHERE users.id = auth.uid()
    )
  );

-- Alta: usuarios del propio tenant, dentro de su carpeta.
DROP POLICY IF EXISTS logos_tenant_insert ON storage.objects;
CREATE POLICY logos_tenant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT (users.tenant_id)::text FROM users WHERE users.id = auth.uid()
    )
  );

-- Actualización (upsert del logo) del propio tenant.
DROP POLICY IF EXISTS logos_tenant_update ON storage.objects;
CREATE POLICY logos_tenant_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT (users.tenant_id)::text FROM users WHERE users.id = auth.uid()
    )
  );

-- Borrado del propio tenant.
DROP POLICY IF EXISTS logos_tenant_delete ON storage.objects;
CREATE POLICY logos_tenant_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT (users.tenant_id)::text FROM users WHERE users.id = auth.uid()
    )
  );
