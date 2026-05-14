-- Migration 095: OC derivadas y reembolsos por diferencia en recepción

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS oc_padre_id UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS es_derivada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiene_reembolso_pendiente BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_oc_padre ON ordenes_compra(oc_padre_id) WHERE oc_padre_id IS NOT NULL;
