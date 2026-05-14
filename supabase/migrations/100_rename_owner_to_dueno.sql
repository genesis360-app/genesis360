-- Migration 100: Renombrar rol 'OWNER' → 'DUEÑO' en toda la base de datos
-- Incluye: constraint, data, políticas RLS, función is_rrhh(), caja_fuerte_roles

-- ─── 1. Actualizar CHECK constraint en users ──────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'RRHH', 'DEPOSITO', 'CONTADOR'));

-- ─── 2. Actualizar datos existentes ──────────────────────────────────────────
UPDATE users SET rol = 'DUEÑO' WHERE rol = 'OWNER';

-- ─── 3. Actualizar caja_fuerte_roles en tenants ───────────────────────────────
-- Cambiar default de la columna
ALTER TABLE tenants
  ALTER COLUMN caja_fuerte_roles SET DEFAULT ARRAY['DUEÑO','SUPERVISOR','ADMIN'];

-- Actualizar registros existentes que tenían 'OWNER' en el array
UPDATE tenants
  SET caja_fuerte_roles = array_replace(caja_fuerte_roles, 'OWNER', 'DUEÑO')
  WHERE 'OWNER' = ANY(caja_fuerte_roles);

-- ─── 4. Recrear políticas RLS que referenciaban 'OWNER' ──────────────────────

-- tenants_update
DROP POLICY IF EXISTS "tenants_update" ON tenants;
CREATE POLICY "tenants_update" ON tenants FOR UPDATE
  USING (
    (id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) AND
     EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND rol IN ('DUEÑO','ADMIN')))
    OR is_admin()
  );

-- users_insert_owner
DROP POLICY IF EXISTS "users_insert_owner" ON users;
CREATE POLICY "users_insert_owner" ON users FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('DUEÑO','ADMIN'));

-- users_update_owner
DROP POLICY IF EXISTS "users_update_owner" ON users;
CREATE POLICY "users_update_owner" ON users FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('DUEÑO','ADMIN'));

-- actividad_log_select
DROP POLICY IF EXISTS "actividad_log_select" ON actividad_log;
CREATE POLICY "actividad_log_select" ON actividad_log
  FOR SELECT USING (
    is_admin()
    OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND rol IN ('DUEÑO', 'SUPERVISOR'))
  );

-- ─── 5. Recrear función is_rrhh() ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_rrhh()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND (rol = 'RRHH' OR rol = 'DUEÑO')
  )
$$;

-- ─── 6. Actualizar puede_ver_todas para DUEÑO ────────────────────────────────
-- (por si hay algún registro que quedó con la migración 094 con rol OWNER)
UPDATE users SET puede_ver_todas = true WHERE rol = 'DUEÑO' AND puede_ver_todas = false;
