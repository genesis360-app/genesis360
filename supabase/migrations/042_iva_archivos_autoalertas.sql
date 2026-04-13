-- Migration 042: IVA por producto + venta_items histórico + precio_venta_snapshot
--              + auto-resolve alertas stock + es_sistema en motivos + archivos_biblioteca

-- ─── 1. Alícuota IVA en productos ────────────────────────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2) NOT NULL DEFAULT 21
    CHECK (alicuota_iva IN (0, 10.5, 21, 27));

-- ─── 2. IVA histórico en venta_items ─────────────────────────────────────────
ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS iva_monto    DECIMAL(12,2);

-- ─── 3. Precio de venta snapshot en inventario_lineas ────────────────────────
ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS precio_venta_snapshot DECIMAL(14,2);

-- ─── 4. es_sistema en motivos_movimiento ─────────────────────────────────────
-- Permite ocultar motivos automáticos del UI de rebaje/ingreso manual
ALTER TABLE motivos_movimiento
  ADD COLUMN IF NOT EXISTS es_sistema BOOLEAN NOT NULL DEFAULT FALSE;

-- Marcar el motivo "Ventas" como sistema si existe
UPDATE motivos_movimiento
SET es_sistema = TRUE
WHERE LOWER(nombre) = 'ventas';

-- ─── 5. Auto-resolve alertas de stock ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_resolver_alerta_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Cuando el stock sube por encima del mínimo, resolver alertas pendientes
  IF NEW.stock_actual > NEW.stock_minimo THEN
    UPDATE alertas
    SET resuelta = TRUE
    WHERE producto_id = NEW.id
      AND tipo       = 'stock_minimo'
      AND resuelta   = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'productos_stock_auto_resolver'
  ) THEN
    CREATE TRIGGER productos_stock_auto_resolver
      AFTER UPDATE OF stock_actual ON productos
      FOR EACH ROW EXECUTE FUNCTION auto_resolver_alerta_stock();
  END IF;
END $$;

-- ─── 6. Tabla archivos_biblioteca ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archivos_biblioteca (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'otro'
    CHECK (tipo IN (
      'certificado_afip_crt',
      'certificado_afip_key',
      'contrato',
      'factura_proveedor',
      'manual',
      'otro'
    )),
  descripcion   TEXT,
  storage_path  TEXT NOT NULL,
  tamanio       BIGINT,
  mime_type     TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE archivos_biblioteca ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_archivos_biblioteca_tenant
  ON archivos_biblioteca(tenant_id, tipo);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'archivos_biblioteca' AND policyname = 'archivos_biblioteca_tenant'
  ) THEN
    CREATE POLICY "archivos_biblioteca_tenant" ON archivos_biblioteca
      FOR ALL USING (
        tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
      );
  END IF;
END $$;

-- ─── 7. Storage bucket archivos-biblioteca ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('archivos-biblioteca', 'archivos-biblioteca', false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'archivos_biblioteca_storage_select'
  ) THEN
    CREATE POLICY "archivos_biblioteca_storage_select" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'archivos-biblioteca'
        AND auth.uid() IN (
          SELECT u.id FROM users u
          WHERE u.tenant_id = (
            SELECT tenant_id FROM users WHERE id = auth.uid() LIMIT 1
          )
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'archivos_biblioteca_storage_insert'
  ) THEN
    CREATE POLICY "archivos_biblioteca_storage_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'archivos-biblioteca'
        AND auth.uid() IS NOT NULL
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'archivos_biblioteca_storage_delete'
  ) THEN
    CREATE POLICY "archivos_biblioteca_storage_delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'archivos-biblioteca'
        AND auth.uid() IN (
          SELECT u.id FROM users u
          WHERE u.tenant_id = (
            SELECT tenant_id FROM users WHERE id = auth.uid() LIMIT 1
          )
        )
      );
  END IF;
END $$;
