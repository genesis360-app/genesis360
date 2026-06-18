-- migration 223: tickets de soporte del panel interno (Fase 1/2).
--
-- Tickets que el equipo de soporte gestiona por cada cliente (tenant). Toda lectura/escritura
-- pasa por la EF admin-api (service_role); por eso RLS queda ENABLE sin policies para
-- authenticated (default-deny) — el cliente del panel nunca toca estas tablas directo.

CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asunto      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'abierto'
                CHECK (estado IN ('abierto','en_progreso','esperando','resuelto','cerrado')),
  prioridad   TEXT NOT NULL DEFAULT 'media'
                CHECK (prioridad IN ('baja','media','alta','urgente')),
  canal       TEXT NOT NULL DEFAULT 'manual'
                CHECK (canal IN ('manual','email','in_app')),
  asignado_a  UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  creado_por  UUID REFERENCES support_agents(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant   ON support_tickets(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_estado   ON support_tickets(estado) WHERE estado <> 'cerrado';
CREATE INDEX IF NOT EXISTS idx_support_tickets_asignado ON support_tickets(asignado_a);

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  autor_tipo  TEXT NOT NULL DEFAULT 'agente' CHECK (autor_tipo IN ('agente','cliente','sistema')),
  autor_id    UUID,                 -- support_agents.id si es agente (sin FK para permitir 'sistema'/'cliente')
  cuerpo      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
-- Sin policies para authenticated → solo la EF admin-api (service_role) lee/escribe.

COMMENT ON TABLE support_tickets  IS 'Panel de soporte: tickets por cliente (tenant). Gestionados vía EF admin-api.';
COMMENT ON TABLE support_messages IS 'Panel de soporte: hilo de mensajes de un ticket.';
