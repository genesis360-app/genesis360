-- Migration 080: estado + vínculo con gasto para presupuestos de servicios
ALTER TABLE servicio_presupuestos
  ADD COLUMN IF NOT EXISTS estado  TEXT DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aprobado','rechazado','convertido')),
  ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;
