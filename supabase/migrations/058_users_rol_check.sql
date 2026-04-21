-- ─── Migration 058: Ampliar CHECK constraint de users.rol ────────────────────
-- Los roles RRHH, DEPOSITO, CONTADOR se usaban en código pero no estaban en el
-- CHECK → violación al insertar usuarios con esos roles.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('OWNER', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'RRHH', 'DEPOSITO', 'CONTADOR'));
