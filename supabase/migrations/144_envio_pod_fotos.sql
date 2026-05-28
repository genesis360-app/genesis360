-- Migration 144: múltiples fotos por POD (proof of delivery)
-- Soporta N fotos por envío (paquete + receptor + DNI + estado de mercadería).
-- Mantiene compatibilidad con envios.pod_url (la primera foto principal).

CREATE TABLE IF NOT EXISTS envio_pod_fotos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id      UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  storage_path  TEXT,
  orden         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_envio_pod_fotos_envio ON envio_pod_fotos(envio_id, orden);
CREATE INDEX IF NOT EXISTS idx_envio_pod_fotos_tenant ON envio_pod_fotos(tenant_id);

ALTER TABLE envio_pod_fotos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='envio_pod_fotos_tenant' AND tablename='envio_pod_fotos') THEN
    CREATE POLICY "envio_pod_fotos_tenant" ON envio_pod_fotos FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE envio_pod_fotos IS 'Fotos adicionales del POD (proof of delivery) por envío. La primera (orden=0) puede coincidir con envios.pod_url para retro-compatibilidad.';
COMMENT ON COLUMN envio_pod_fotos.storage_path IS 'Path en bucket etiquetas-envios. Útil para regenerar signedUrl al expirar.';

-- Backfill: por cada envío con pod_url, crea fila orden=0
INSERT INTO envio_pod_fotos (envio_id, tenant_id, url, orden, created_at)
SELECT e.id, e.tenant_id, e.pod_url, 0, COALESCE(e.updated_at, e.created_at)
FROM envios e
WHERE e.pod_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM envio_pod_fotos f WHERE f.envio_id = e.id);
