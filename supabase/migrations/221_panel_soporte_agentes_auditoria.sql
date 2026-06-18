-- migration 221: cimientos del PANEL INTERNO DE SOPORTE (admin.genesis360.pro)
--
-- Opción C de auth: los agentes de soporte usan el MISMO Supabase Auth (auth.users) que los
-- clientes, pero se distinguen por (1) tener fila en `support_agents` (perfil + activo, autoridad
-- de runtime para revocar) y (2) llevar un claim `app_metadata.staff=true` en el JWT (no
-- auto-asignable: lo setea solo service_role al dar de alta al agente).
--
-- Regla de oro: el panel NUNCA lee tablas de clientes directo — todo va por la Edge Function
-- `admin-api` (service_role) que valida agente + audita. Los agentes no pertenecen a ningún tenant,
-- así que la RLS por-tenant existente igual les devuelve 0 si intentaran ir directo.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Agentes de soporte (staff interno). NO son usuarios de un tenant.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_agents (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  nombre      TEXT,
  rol         TEXT NOT NULL DEFAULT 'agent' CHECK (rol IN ('agent','supervisor','admin')),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_agents_activo ON support_agents(activo) WHERE activo = TRUE;

ALTER TABLE support_agents ENABLE ROW LEVEL SECURITY;

-- El cliente del panel NO lee/escribe esta tabla directo (va por la EF service_role).
-- Como red de seguridad, se permite SOLO que un agente lea su propia fila; escrituras = service_role.
DROP POLICY IF EXISTS support_agents_self_read ON support_agents;
CREATE POLICY support_agents_self_read ON support_agents
  FOR SELECT USING (id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Auditoría de TODO acceso del panel (append-only, ledger).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_email      TEXT,
  action           TEXT NOT NULL,                 -- p.ej. 'customers.get', 'impersonation.start'
  target_tenant_id UUID,                           -- tenant accedido (si aplica)
  target_user_id   UUID,                           -- usuario accedido (si aplica)
  metadata         JSONB,
  ip               TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_agent  ON admin_audit_log(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant ON admin_audit_log(target_tenant_id, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
-- Sin policies para el rol authenticated → el cliente NO puede leer ni escribir el log.
-- Lo escribe/lee exclusivamente la EF `admin-api` con service_role (bypassa RLS). Append-only.

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Helper: ¿el caller es staff activo? (para futuras RLS del panel)
--    Autoridad de runtime = la tabla (revocar = activo=false, efecto inmediato).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_staff()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM support_agents WHERE id = auth.uid() AND activo)
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

COMMENT ON TABLE support_agents  IS 'Panel de soporte: agentes internos (staff). No pertenecen a ningún tenant. Opción C: + claim app_metadata.staff en el JWT.';
COMMENT ON TABLE admin_audit_log IS 'Panel de soporte: ledger append-only de todo acceso del staff a datos de clientes. Escrito por la EF admin-api (service_role).';
