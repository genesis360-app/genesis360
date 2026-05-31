-- Migration 157: ISS-127 — Perfiles de códigos compuestos (GS1 / custom)
--
-- Un perfil define cómo se GENERA un código compuesto (y, para formatos no-GS1,
-- también cómo se PARSEA). El parseo GS1 es autodescriptivo (los AIs vienen en
-- el código), así que para GS1 el perfil gobierna sobre todo la generación.
--
-- Decisiones (relevado GO 2026-05-30):
--   tipo='gs1'    → simbología gs1_128 (1D) o datamatrix (2D); `ais` = qué AIs incluir.
--   tipo='custom' → proveedor que no usa GS1; `custom_format` = {separador, campos[]}.
--   proveedor_id  → opcional, asocia el perfil a un proveedor.
--   lectura_modo  → 'autocompletar' (rellena form + confirma) | 'directo' (crea LPN al instante).

CREATE TABLE IF NOT EXISTS codigo_perfiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  proveedor_id  UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL DEFAULT 'gs1',          -- 'gs1' | 'custom'
  simbologia    TEXT NOT NULL DEFAULT 'gs1_128',      -- 'gs1_128' | 'datamatrix'
  ais           JSONB NOT NULL DEFAULT '["01","10","17","37"]'::jsonb,  -- AIs a generar (tipo gs1)
  custom_format JSONB,                                 -- {separador, campos:[{ai|campo, longitud?}]} (tipo custom)
  lectura_modo  TEXT NOT NULL DEFAULT 'autocompletar', -- 'autocompletar' | 'directo'
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codigo_perfiles_tenant    ON codigo_perfiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_codigo_perfiles_proveedor ON codigo_perfiles(tenant_id, proveedor_id);

ALTER TABLE codigo_perfiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='codigo_perfiles_tenant' AND tablename='codigo_perfiles') THEN
    CREATE POLICY "codigo_perfiles_tenant" ON codigo_perfiles FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE codigo_perfiles IS
  'ISS-127: perfiles de códigos compuestos. tipo gs1 (ais a generar) o custom (custom_format). proveedor_id opcional. lectura_modo decide autocompletar vs LPN directo al escanear.';
