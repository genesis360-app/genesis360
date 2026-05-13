-- Migration 099: columna metadata en notificaciones para payloads de acciones (aprobación caja fuerte, etc.)

ALTER TABLE notificaciones
  ADD COLUMN IF NOT EXISTS metadata JSONB;
