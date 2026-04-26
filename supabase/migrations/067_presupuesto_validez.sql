ALTER TABLE tenants ADD COLUMN IF NOT EXISTS presupuesto_validez_dias INT DEFAULT 30;
COMMENT ON COLUMN tenants.presupuesto_validez_dias IS 'Días de validez de un presupuesto (estado pendiente)';
