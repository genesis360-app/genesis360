-- ============================================================
-- Migration 048: Gastos — IVA deducible + comprobantes + gastos fijos
-- ============================================================

-- ─── Columnas en gastos ──────────────────────────────────────────────────────
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS iva_monto       DECIMAL(12,2);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

-- ─── Gastos fijos (recurrentes) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gastos_fijos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descripcion     TEXT NOT NULL,
  monto           DECIMAL(12,2) NOT NULL,
  iva_monto       DECIMAL(12,2),
  categoria       TEXT,
  medio_pago      TEXT,
  frecuencia      TEXT NOT NULL DEFAULT 'mensual'
                    CHECK (frecuencia IN ('mensual', 'quincenal', 'semanal')),
  dia_vencimiento INT CHECK (dia_vencimiento BETWEEN 1 AND 31),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  notas           TEXT,
  sucursal_id     UUID REFERENCES sucursales(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gastos_fijos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_gastos_fijos_tenant ON gastos_fijos(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gastos_fijos' AND policyname = 'gastos_fijos_tenant') THEN
    CREATE POLICY "gastos_fijos_tenant" ON gastos_fijos FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── Storage bucket comprobantes-gastos ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-gastos',
  'comprobantes-gastos',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'comp_gastos_select' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "comp_gastos_select" ON storage.objects FOR SELECT
      USING (bucket_id = 'comprobantes-gastos' AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'comp_gastos_insert' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "comp_gastos_insert" ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'comprobantes-gastos' AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'comp_gastos_delete' AND tablename = 'objects' AND schemaname = 'storage') THEN
    CREATE POLICY "comp_gastos_delete" ON storage.objects FOR DELETE
      USING (bucket_id = 'comprobantes-gastos' AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM tenants WHERE id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      ));
  END IF;
END $$;
