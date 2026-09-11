-- Migration 392: lista de números autorizados a hablarle al asistente de WhatsApp.
--
-- ORIGEN: prueba real de GO/Fede el 2026-09-05. Fede escribió al número del asistente desde un número
-- NO autorizado (`5491166100297`) para validar que el bot no le respondiera. Meta efectivamente bloqueó
-- la ENTREGA de la respuesta (error 131030), pero recién al final del proceso: para entonces
-- `wa-webhook` ya había llamado a Claude (~4.300 tokens de entrada pagados por nosotros), había
-- consultado el STOCK REAL del negocio, y había CREADO UN BORRADOR DE GASTO dentro del tenant.
--
-- Hoy eso está tapado por una casualidad: el número de PRUEBA de Meta solo entrega a 5 destinatarios
-- verificados. Esa lista es un artefacto del número de test y DESAPARECE con un número real, donde
-- cualquiera que consiga el número puede escribir. Sin este control, con un número productivo:
--   1. cada spam / número equivocado / cliente curioso cuesta tokens de Claude;
--   2. un desconocido puede consultar stock y precios reales del negocio;
--   3. un desconocido puede generar borradores de gasto (no llegan a gasto real — siguen exigiendo
--      aprobación humana — pero ensucian la bandeja).
--
-- Además choca con el diseño acordado: el asistente es para el DUEÑO del negocio, no para clientes
-- finales (eso sería un 2do agente, de solo lectura, todavía no construido).
--
-- COMPORTAMIENTO ELEGIDO POR GO: a un número no autorizado se lo IGNORA EN SILENCIO. El mensaje igual
-- queda registrado en `whatsapp_mensajes_log` (para poder ver quién escribió), pero no se llama a
-- Claude ni se responde. Responder costaría un mensaje y, con un número real, sería pagarle al spam.

CREATE TABLE IF NOT EXISTS whatsapp_numeros_autorizados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Solo dígitos, sin `+` ni separadores: es el formato exacto en que Meta manda `messages[].from`
  -- (ej. "5491166100297"). La app normaliza antes de guardar; el CHECK lo blinda a nivel DB.
  numero      TEXT NOT NULL CHECK (numero ~ '^[0-9]{6,20}$'),
  nombre      TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_wa_autorizados_tenant
  ON whatsapp_numeros_autorizados (tenant_id) WHERE activo;

ALTER TABLE whatsapp_numeros_autorizados ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario del tenant.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_numeros_autorizados' AND policyname = 'wa_autorizados_lectura'
  ) THEN
    CREATE POLICY wa_autorizados_lectura ON whatsapp_numeros_autorizados
      FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = (select auth.uid())));
  END IF;
END $$;

-- Escritura: SOLO DUEÑO/ADMIN. Guard server-side ADEMÁS del gateo de la UI — autorizar un número es
-- darle acceso de lectura al stock y a los precios del negocio, así que un usuario de rol bajo no
-- puede auto-autorizarse el celular.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_numeros_autorizados' AND policyname = 'wa_autorizados_escritura_owner'
  ) THEN
    CREATE POLICY wa_autorizados_escritura_owner ON whatsapp_numeros_autorizados
      FOR ALL TO authenticated
      USING (tenant_id IN (
        SELECT tenant_id FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO', 'ADMIN')
      ))
      WITH CHECK (tenant_id IN (
        SELECT tenant_id FROM users WHERE id = (select auth.uid()) AND rol IN ('DUEÑO', 'ADMIN')
      ));
  END IF;
END $$;

REVOKE ALL ON whatsapp_numeros_autorizados FROM anon;

CREATE OR REPLACE FUNCTION fn_updated_at_wa_autorizados()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_wa_autorizados ON whatsapp_numeros_autorizados;
CREATE TRIGGER trg_updated_at_wa_autorizados
  BEFORE UPDATE ON whatsapp_numeros_autorizados
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_wa_autorizados();

COMMENT ON TABLE whatsapp_numeros_autorizados IS
  'Números habilitados a hablarle al asistente de WhatsApp de cada tenant. Un número fuera de esta lista se ignora en silencio ANTES de gastar tokens de IA. El numero_notificaciones del dueño (whatsapp_credentials, mig 385) queda autorizado implícitamente, sin necesidad de cargarlo acá.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Semilla: el número de notificaciones ya configurado (el del dueño) pasa a la lista explícita, para
-- que la UI lo muestre desde el principio en vez de que parezca que no hay nadie autorizado.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_numeros_autorizados (tenant_id, numero, nombre)
SELECT c.tenant_id, regexp_replace(c.numero_notificaciones, '[^0-9]', '', 'g'), 'Dueño (número de notificaciones)'
FROM whatsapp_credentials c
WHERE c.numero_notificaciones IS NOT NULL
  AND regexp_replace(c.numero_notificaciones, '[^0-9]', '', 'g') ~ '^[0-9]{6,20}$'
ON CONFLICT (tenant_id, numero) DO NOTHING;
