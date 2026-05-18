-- Migration 113: política DELETE en tabla users
-- Sin esta política, RLS bloqueaba silenciosamente todo DELETE (0 filas, sin error).
-- Esto impedía "Salir del negocio" y "Eliminar cuenta" en MiCuentaPage.

CREATE POLICY users_delete_self ON users
  FOR DELETE USING (id = auth.uid());

CREATE POLICY users_delete_owner ON users
  FOR DELETE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['DUEÑO', 'ADMIN'])
  );
