-- Migration 094: sucursal_id + puede_ver_todas en users
-- Permite restringir usuarios a una sucursal específica y controlar la vista global

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS puede_ver_todas BOOLEAN NOT NULL DEFAULT false;

-- SUPERVISOR y CONTADOR: true por defecto (roles con visión global habitual)
UPDATE users SET puede_ver_todas = true WHERE rol IN ('SUPERVISOR', 'CONTADOR', 'ADMIN', 'OWNER');

CREATE INDEX IF NOT EXISTS idx_users_sucursal ON users(tenant_id, sucursal_id);
