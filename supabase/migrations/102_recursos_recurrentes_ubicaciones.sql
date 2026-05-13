-- Migration 102: recursos recurrentes + ubicacion_id como referencia opcional

ALTER TABLE recursos
  ADD COLUMN IF NOT EXISTS es_recurrente       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frecuencia_valor    INT,
  ADD COLUMN IF NOT EXISTS frecuencia_unidad   TEXT        CHECK (frecuencia_unidad IN ('dia','semana','mes','año')),
  ADD COLUMN IF NOT EXISTS proximo_vencimiento DATE;

CREATE INDEX IF NOT EXISTS idx_recursos_recurrentes
  ON recursos(tenant_id, proximo_vencimiento)
  WHERE es_recurrente = true;
