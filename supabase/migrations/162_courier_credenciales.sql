-- Migration 162: ISS-174 F1 — credenciales de courier por tenant + fuente de peso
--
-- Decisiones (relevado GO 2026-05-31):
--   * APIs directas por courier (Andreani → Correo Argentino → OCA ePak).
--   * Credenciales POR TENANT: cada negocio carga las suyas. Una fila por (tenant, courier).
--   * Por seguridad, los secretos solo se usan server-side (Edge Functions con service_role,
--     ISS-174 F2+). El front NUNCA debe hacer SELECT de `credenciales`: la UI de Config
--     lee solo {courier, activo, updated_at} para mostrar el estado "configurado".
--   * `envio_peso_fuente` decide de dónde sale el peso/medidas al cotizar:
--       'manual'   (default) → el operador carga peso/medidas del bulto por envío.
--       'producto'           → se toma del dato maestro del producto y se suma el carrito.
--
-- Hardening pendiente (no bloquea F1): mover `credenciales` a Supabase Vault / pgsodium
-- y/o gatear el SELECT a roles owner/admin. Hoy queda bajo RLS por tenant + UI owner-only.

CREATE TABLE IF NOT EXISTS courier_credenciales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  courier      TEXT NOT NULL,                         -- 'Andreani' | 'Correo Argentino' | 'OCA' | ...
  credenciales JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {usuario, password, client_id, client_secret, nro_contrato, ...} según courier
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, courier)
);

CREATE INDEX IF NOT EXISTS idx_courier_credenciales_tenant ON courier_credenciales(tenant_id);

ALTER TABLE courier_credenciales ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='courier_credenciales_tenant' AND tablename='courier_credenciales') THEN
    CREATE POLICY "courier_credenciales_tenant" ON courier_credenciales FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE courier_credenciales IS
  'ISS-174: credenciales de API de courier por tenant (una fila por courier). Los secretos en `credenciales` solo se usan en Edge Functions; el front no debe seleccionarlos.';

-- Fuente del peso/medidas para cotizar (default manual por envío)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS envio_peso_fuente TEXT NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_envio_peso_fuente_chk') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_envio_peso_fuente_chk CHECK (envio_peso_fuente IN ('manual','producto'));
  END IF;
END $$;

COMMENT ON COLUMN tenants.envio_peso_fuente IS
  'ISS-174: de dónde sale el peso/medidas al cotizar envío. manual = bulto cargado por envío; producto = dato maestro del producto sumando el carrito.';
