-- migration 222: roles del PANEL INTERNO (gestión de acceso por área).
--
-- Amplía el rol de los agentes de soporte para cubrir las 3 personas que pidió GO
-- (soporte / marketing-análisis / admin) + billing. Cada rol ve solo sus módulos
-- (matriz role→módulos en el frontend `config/permissions.ts` + enforzada en la EF admin-api).
-- La tabla sigue llamándose support_agents (staff interno); el `rol` distingue el área.

ALTER TABLE support_agents DROP CONSTRAINT IF EXISTS support_agents_rol_check;

-- Migrar valores viejos del bootstrap inicial (agent/supervisor) al nuevo set.
UPDATE support_agents SET rol = 'support' WHERE rol = 'agent';
UPDATE support_agents SET rol = 'admin'   WHERE rol = 'supervisor';

ALTER TABLE support_agents ALTER COLUMN rol SET DEFAULT 'support';
ALTER TABLE support_agents
  ADD CONSTRAINT support_agents_rol_check CHECK (rol IN ('admin','support','marketing','billing'));

COMMENT ON COLUMN support_agents.rol IS
  'Rol/área del staff: admin (todo + gestión de usuarios), support (Clientes+Soporte), marketing (CRM+Analytics), billing (Facturación). Dashboard lo ven todos.';
