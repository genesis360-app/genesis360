-- ─── Migration 057: Sprint D — LPN Madre (parent_lpn_id) ─────────────────────

ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS parent_lpn_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_lineas_parent_lpn
  ON inventario_lineas(tenant_id, parent_lpn_id)
  WHERE parent_lpn_id IS NOT NULL;
