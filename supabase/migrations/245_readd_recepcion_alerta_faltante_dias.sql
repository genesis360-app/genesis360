-- Migration 245 (v1.90.1) — #4: re-agrega `recepcion_alerta_faltante_dias` a tenants.
-- La columna existía (mig 183) pero la mig 240 la dropeó por "0 referencias" (flag huérfano).
-- Ahora SÍ tiene consumidor: el badge 📦 "Faltante · Nd" en la lista de OC (GastosPage) +
-- el input configurable en Config → Compras. Default 7 días (igual que el original).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS recepcion_alerta_faltante_dias integer NOT NULL DEFAULT 7;
