-- Migration 070: sesión permanente para caja fuerte (sin apertura/cierre diario)
ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS es_permanente BOOLEAN DEFAULT FALSE;
