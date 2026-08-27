-- Migration 382: Fase 1 del "Asistente de WhatsApp con IA" (propuesta de Fede, 25/8/2026, revisada y
-- planificada con GO 2026-08-26). Cimientos de datos para la Edge Function `wa-webhook`: mapeo de
-- número de WhatsApp -> tenant, y log de mensajes (idempotencia + medición básica de tokens desde el
-- día 1, para no tener que reconstruirlo cuando llegue la Sección G de Fede — medición/facturación
-- completa). Alcance de esta fase: SOLO LECTURA (consultas de stock/precio), sin escritura, sin
-- fotos/audio. No se toca `ai-assistant` (motor del chat web, sigue en PROD sin cambios) — el prompt y
-- el modelo de auth de WhatsApp son distintos (sin usuario logueado), ver decisión de diseño en el plan.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. whatsapp_credentials — mapeo phone_number_id (Meta) -> tenant
-- Mismo patrón que tiendanube_credentials/mercadopago_credentials/meli_credentials (mig 061/065):
-- las Edge Functions leen access_token vía service_role, nunca expuesto al frontend. Sin sucursal_id
-- a propósito: el número de WhatsApp representa al negocio completo, no una sucursal puntual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id   TEXT NOT NULL,             -- ID de Meta del número (no el número en sí)
  waba_id           TEXT NOT NULL,             -- WhatsApp Business Account ID
  numero_whatsapp   TEXT,                      -- E.164, solo informativo/UI
  access_token      TEXT NOT NULL,             -- system user token permanente de Meta
  conectado         BOOLEAN NOT NULL DEFAULT TRUE,
  conectado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id),
  UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_creds_tenant ON whatsapp_credentials (tenant_id);

ALTER TABLE whatsapp_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_credentials' AND policyname = 'whatsapp_creds_tenant'
  ) THEN
    CREATE POLICY whatsapp_creds_tenant ON whatsapp_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

REVOKE ALL ON whatsapp_credentials FROM anon;

CREATE OR REPLACE FUNCTION fn_updated_at_whatsapp_creds()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_whatsapp_creds ON whatsapp_credentials;
CREATE TRIGGER trg_updated_at_whatsapp_creds
  BEFORE UPDATE ON whatsapp_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_whatsapp_creds();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. whatsapp_mensajes_log — idempotencia (message_id de Meta) + tokens por mensaje
-- No reusa ventas_externas_logs (esa tabla tiene FK a venta_id, no aplica acá). Solo se toca desde
-- la Edge Function con service_role — insert-primero como patrón de idempotencia (mismo criterio que
-- meli-webhook/mp-webhook: si el INSERT falla por duplicado (23505), es un reintento de Meta del
-- mismo mensaje, no se reprocesa ni se vuelve a llamar a Claude).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_mensajes_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,             -- id de mensaje de Meta (entrante) o generado (saliente)
  direccion         TEXT NOT NULL CHECK (direccion IN ('in', 'out')),
  texto_truncado    TEXT,                      -- primeros ~200 chars, solo para auditoría/debug
  modelo            TEXT,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, message_id, direccion)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_log_tenant ON whatsapp_mensajes_log (tenant_id, created_at);

ALTER TABLE whatsapp_mensajes_log ENABLE ROW LEVEL SECURITY;
-- Sin policies de usuario a propósito: esta tabla solo se lee/escribe vía service_role desde la EF.
REVOKE ALL ON whatsapp_mensajes_log FROM anon, authenticated;
