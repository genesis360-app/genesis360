-- Migration 090: Vincular gastos con recepciones (OC → Gasto automático)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS recepcion_id UUID REFERENCES recepciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_recepcion ON gastos(recepcion_id) WHERE recepcion_id IS NOT NULL;
