-- Migration 383: Fase 2 del "Asistente de WhatsApp con IA" — cargar gastos por WhatsApp como
-- BORRADOR, nunca como gasto real. El bot de WhatsApp (wa-webhook) nunca escribe en `gastos`
-- directamente: crear un gasto real dispara reglas de negocio encadenadas (autorización por
-- umbral de rol, CAJ-18 de saldo de caja, comprobante obligatorio según config del tenant,
-- multi-CUIT, período contable cerrado) que no tiene sentido reimplementar en un contexto sin
-- sesión de usuario real. Un humano revisa cada borrador y lo aprueba desde el mismo modal
-- "Nuevo Gasto" de siempre (GastosPage.tsx, precargado), pasando por el mismo botón "Guardar"
-- de siempre — cero duplicación de lógica fiscal.
--
-- Estado con 2 confirmaciones separadas (REGLA #0 — nunca guardar sin confirmación humana):
--   pendiente_confirmacion -> la IA propuso el gasto, esperando que el REMITENTE de WhatsApp
--     toque el botón "Confirmar" (mensaje interactivo de Meta, no texto libre tipo "SI").
--   pendiente -> confirmado por WhatsApp, visible en la bandeja de revisión de la app.
--   aprobado -> un humano lo aprobó desde el modal "Nuevo Gasto"; gasto_id linkeado.
--   descartado -> rechazado en cualquiera de las 2 etapas (botón "Cancelar" de WhatsApp, o
--     "Descartar" en la bandeja de la app).
CREATE TABLE IF NOT EXISTS whatsapp_gastos_borrador (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descripcion       TEXT NOT NULL,
  monto             NUMERIC(12,2) NOT NULL,
  categoria         TEXT,
  fecha             DATE,
  notas             TEXT,                      -- contexto del mensaje original de WhatsApp
  origen_telefono   TEXT,                       -- número (wa_id) del remitente
  mensaje_id        TEXT,                       -- id de WhatsApp del mensaje que originó la propuesta
  estado            TEXT NOT NULL DEFAULT 'pendiente_confirmacion'
                      CHECK (estado IN ('pendiente_confirmacion', 'pendiente', 'aprobado', 'descartado')),
  gasto_id          UUID REFERENCES gastos(id) ON DELETE SET NULL,
  resuelto_por      UUID REFERENCES users(id) ON DELETE SET NULL,
  resuelto_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_gastos_borrador_tenant_estado
  ON whatsapp_gastos_borrador (tenant_id, estado);

ALTER TABLE whatsapp_gastos_borrador ENABLE ROW LEVEL SECURITY;

-- A diferencia de whatsapp_mensajes_log (mig 382, solo service_role), esta tabla SÍ la toca el
-- frontend con sesión de usuario real (bandeja de revisión + Aprobar/Descartar) — necesita policy
-- de tenant real. El gating por rol (DUEÑO/ADMIN/SUPERVISOR/SUPER_USUARIO) queda en la UI, mismo
-- criterio que autorizaciones_gasto (RLS = borde de tenant, rol = capa de app).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_gastos_borrador' AND policyname = 'whatsapp_gastos_borrador_tenant'
  ) THEN
    CREATE POLICY whatsapp_gastos_borrador_tenant ON whatsapp_gastos_borrador
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
  END IF;
END $$;

REVOKE ALL ON whatsapp_gastos_borrador FROM anon;
