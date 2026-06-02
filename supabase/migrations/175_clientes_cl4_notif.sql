-- ============================================================
-- Migration 175 — Relevamiento Clientes · Fase CL4 (notificaciones)
-- Config de notificaciones de CC + cumpleaños, por tenant.
--   C1 registro de deuda · C4 confirmación de pago (email event-driven)
--   C2 pre-vencimiento (umbral configurable, resaltado en tab CC + WA)
--   C3 escalado (días vencido) · C5 cumpleaños (saludo cliente / lista al dueño)
-- Sin pg_cron: los envíos de email son event-driven; los recordatorios por
-- vencimiento se gestionan desde el tab CC (WA/manual) con umbral configurable.
-- Defaults en OFF: el tenant opta-in (evita mensajería masiva inesperada al deployar).
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cc_notif_canales        TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::TEXT[], -- email | whatsapp
  ADD COLUMN IF NOT EXISTS cc_notif_registro_deuda BOOLEAN NOT NULL DEFAULT FALSE,  -- C1
  ADD COLUMN IF NOT EXISTS cc_notif_pago           BOOLEAN NOT NULL DEFAULT FALSE,  -- C4
  ADD COLUMN IF NOT EXISTS cc_notif_pre_venc_dias  INT DEFAULT 3,                   -- C2 (NULL = sin recordatorio)
  ADD COLUMN IF NOT EXISTS cc_notif_escalado_dias  INT,                             -- C3 (NULL = sin escalado)
  ADD COLUMN IF NOT EXISTS cumple_notif_cliente    BOOLEAN NOT NULL DEFAULT FALSE,  -- C5 saludo al cliente
  ADD COLUMN IF NOT EXISTS cumple_notif_duenio     BOOLEAN NOT NULL DEFAULT FALSE;  -- C5 lista al dueño
