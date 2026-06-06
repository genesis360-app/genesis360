-- ============================================================
-- Migration 183 — Compras · CO2 (Recepción robusta)
--   B3 over-receipt umbral % · B4 motivo de faltante + alerta · B7 remito adjunto.
--   (B5 robustez = recálculo acumulado en la app, sin columna nueva.)
--   Aditiva e idempotente. Sin DDL destructivo.
-- ============================================================

-- B4 — motivo obligatorio del faltante en under-receipt (por línea recibida de menos).
ALTER TABLE recepcion_items
  ADD COLUMN IF NOT EXISTS motivo_faltante TEXT;

-- B7 — comprobante (remito) del proveedor adjunto a la recepción.
ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS remito_url TEXT;

-- B3 — over-receipt: umbral % máximo sobre lo pedido (extiende el bool global existente).
-- B4 — días para alertar OCs con faltante sin resolver.  B7 — remito obligatorio.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS over_receipt_pct_max NUMERIC,
  ADD COLUMN IF NOT EXISTS recepcion_remito_obligatorio BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recepcion_alerta_faltante_dias INTEGER NOT NULL DEFAULT 7;

-- B7 — bucket privado para los remitos de proveedor (path = <tenant_id>/<uuid>.<ext>).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('remitos', 'remitos', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='remitos_select') THEN
    CREATE POLICY "remitos_select" ON storage.objects FOR SELECT USING (
      bucket_id = 'remitos'
      AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM users WHERE id = auth.uid() LIMIT 1)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='remitos_insert') THEN
    CREATE POLICY "remitos_insert" ON storage.objects FOR INSERT WITH CHECK (
      bucket_id = 'remitos'
      AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM users WHERE id = auth.uid() LIMIT 1)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='remitos_delete') THEN
    CREATE POLICY "remitos_delete" ON storage.objects FOR DELETE USING (
      bucket_id = 'remitos'
      AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM users WHERE id = auth.uid() LIMIT 1)
    );
  END IF;
END $$;
