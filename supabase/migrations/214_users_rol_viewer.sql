-- ─── Migration 214: Agregar rol fijo VIEWER (Lector) al CHECK de users.rol ───
-- Rol pasivo de solo-lectura para PyMEs/empresas: supervisa la operación sin editar.
-- El enforcement de solo-lectura es en la app (permisosModulo.ts: VIEWER → solo-lectura
-- en todos los módulos); acá solo se amplía la constraint para poder asignar el rol.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'RRHH', 'DEPOSITO', 'CONTADOR', 'VIEWER'));
