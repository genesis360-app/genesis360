-- Migration 043: Certificados AFIP por tenant

CREATE TABLE IF NOT EXISTS tenant_certificates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cert_crt_path       TEXT NOT NULL,
  cert_key_path       TEXT NOT NULL,
  cuit                TEXT,
  fecha_validez_hasta DATE,
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

ALTER TABLE tenant_certificates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_certificates' AND policyname = 'tenant_certificates_tenant'
  ) THEN
    CREATE POLICY "tenant_certificates_tenant" ON tenant_certificates
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_certificates_tenant ON tenant_certificates(tenant_id);

DROP TRIGGER IF EXISTS tr_tenant_certificates_updated_at ON tenant_certificates;
CREATE TRIGGER tr_tenant_certificates_updated_at
  BEFORE UPDATE ON tenant_certificates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Storage bucket certificados-afip (privado, 1 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certificados-afip',
  'certificados-afip',
  false,
  1048576,
  ARRAY['application/x-pem-file', 'application/octet-stream', 'application/x-x509-ca-cert']
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'certs_storage_select'
  ) THEN
    CREATE POLICY "certs_storage_select" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'certificados-afip'
        AND (storage.foldername(name))[1] IN (
          SELECT tenant_id::text FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'certs_storage_insert'
  ) THEN
    CREATE POLICY "certs_storage_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'certificados-afip'
        AND auth.uid() IS NOT NULL
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'certs_storage_delete'
  ) THEN
    CREATE POLICY "certs_storage_delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'certificados-afip'
        AND (storage.foldername(name))[1] IN (
          SELECT tenant_id::text FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;
