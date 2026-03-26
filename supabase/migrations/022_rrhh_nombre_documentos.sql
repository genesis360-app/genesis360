-- Migration 022: RRHH Phase 2C + 4A
-- Agrega nombre/apellido a empleados + tabla rrhh_documentos

-- Phase 2C: nombre y apellido en empleados
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS nombre   TEXT NOT NULL DEFAULT '';
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS apellido TEXT;

-- Phase 4A: documentos por empleado
CREATE TABLE IF NOT EXISTS rrhh_documentos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  descripcion  TEXT,
  tipo         TEXT CHECK (tipo IN ('contrato','certificado','cv','foto','otro')) DEFAULT 'otro',
  storage_path TEXT NOT NULL,
  tamanio      BIGINT,
  mime_type    TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_documentos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rrhh_documentos' AND policyname = 'rrhh_documentos_tenant'
  ) THEN
    CREATE POLICY "rrhh_documentos_tenant" ON rrhh_documentos
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_empleado ON rrhh_documentos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_tenant   ON rrhh_documentos(tenant_id);

-- Storage: bucket empleados (crear via Dashboard o CLI, aquí solo las policies)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('empleados', 'empleados', false) ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'empleados_bucket_select'
  ) THEN
    CREATE POLICY "empleados_bucket_select" ON storage.objects FOR SELECT
      USING (bucket_id = 'empleados'
        AND auth.uid() IN (
          SELECT u.id FROM users u
          WHERE u.tenant_id = (
            SELECT e.tenant_id FROM empleados e
            WHERE e.id::text = (storage.foldername(name))[1]
          )
        ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'empleados_bucket_insert'
  ) THEN
    CREATE POLICY "empleados_bucket_insert" ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'empleados'
        AND auth.uid() IN (
          SELECT u.id FROM users u
          WHERE u.tenant_id = (
            SELECT e.tenant_id FROM empleados e
            WHERE e.id::text = (storage.foldername(name))[1]
          )
        ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'empleados_bucket_delete'
  ) THEN
    CREATE POLICY "empleados_bucket_delete" ON storage.objects FOR DELETE
      USING (bucket_id = 'empleados'
        AND auth.uid() IN (
          SELECT u.id FROM users u
          WHERE u.tenant_id = (
            SELECT e.tenant_id FROM empleados e
            WHERE e.id::text = (storage.foldername(name))[1]
          )
        ));
  END IF;
END $$;
