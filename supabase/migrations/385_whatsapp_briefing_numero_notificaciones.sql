-- Migration 385: Fase 4 del "Asistente de WhatsApp con IA" — briefing diario proactivo.
-- Gap real encontrado al diseñar: no existía ninguna columna para "a qué número mandarle un mensaje
-- PROACTIVO" (business-initiated, sin que el usuario escriba primero). `numero_whatsapp` (mig 382)
-- es el número del NEGOCIO (el WABA), documentado explícitamente como "solo informativo/UI" — no
-- sirve como destinatario. Nullable: si está vacío, el sweep `wa-briefing-sweep` simplemente no
-- manda nada para ese tenant.
ALTER TABLE whatsapp_credentials ADD COLUMN IF NOT EXISTS numero_notificaciones TEXT;

COMMENT ON COLUMN whatsapp_credentials.numero_notificaciones IS
  'E.164 de la persona a la que el sweep wa-briefing-sweep le manda el briefing diario proactivo (Fase 4). Distinto de numero_whatsapp (número del negocio/WABA, solo informativo). Dato personal (PII) — no loguear en texto plano, no exponer en reportes agregados.';
