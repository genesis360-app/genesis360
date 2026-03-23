-- Migración 012: campo disponible_surtido en ubicaciones
-- Controla si desde esa posición se puede descontar stock en ventas/rebaje automatico
-- Las lineas sin ubicacion (ubicacion_id IS NULL) quedan excluidas del flujo de ventas

ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS disponible_surtido BOOLEAN NOT NULL DEFAULT TRUE;
