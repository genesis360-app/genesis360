-- Migration 037: roles_custom — roles personalizados con permisos por módulo
-- Complementa los roles fijos (OWNER, SUPERVISOR, CAJERO, RRHH, ADMIN).
-- Los usuarios asignados a un rol custom usan permisos de la tabla en lugar del rol fijo.

CREATE TABLE IF NOT EXISTS roles_custom (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  -- permisos: { "ventas": "editar"|"ver"|"no_ver", "caja": "editar"|"ver"|"no_ver", ... }
  permisos    JSONB NOT NULL DEFAULT '{}',
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, nombre)
);

ALTER TABLE roles_custom ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'roles_custom' AND policyname = 'roles_custom_tenant'
  ) THEN
    CREATE POLICY "roles_custom_tenant" ON roles_custom
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_custom_tenant ON roles_custom(tenant_id);

-- Columna rol_custom_id en users (FK opcional — si está seteada, tiene prioridad sobre rol fijo)
ALTER TABLE users ADD COLUMN IF NOT EXISTS rol_custom_id UUID REFERENCES roles_custom(id) ON DELETE SET NULL;
