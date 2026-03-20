-- M13: Caja — conteo real al cierre y trazabilidad de quién cerró
ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS monto_real_cierre DECIMAL(12,2);
ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS diferencia_cierre  DECIMAL(12,2);
ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS cerrado_por_id     UUID REFERENCES users(id);
