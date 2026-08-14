-- ============================================================
-- 358_hard_delete_grace_period.sql
-- Hard delete de tenant con grace period (pedido de GO 2026-08-13). Hoy "Eliminar cuenta y negocio"
-- (MiCuentaPage.tsx) hace un soft delete inmediato: borra la fila de `users` y cancela la
-- suscripción, pero los datos del tenant (productos, ventas, inventario, etc.) quedan en la DB para
-- siempre. Pasa a ser: programar el borrado definitivo a 30 días, con reactivación self-service
-- (el dueño puede loguearse durante la ventana y cancelarlo él mismo — ver banner en AppLayout.tsx).
--
-- `tenants.delete_scheduled_at`: NULL = sin baja programada. Seteado = fecha en la que un sweep
-- diario (GitHub Actions, el proyecto no tiene pg_cron) hace el DELETE definitivo — el CASCADE de
-- las ~140 FK a tenant_id se encarga del resto.
--
-- Fix de bloqueo real encontrado al auditar: TODAS las FK a tenant_id tienen ON DELETE CASCADE
-- EXCEPTO `autorizaciones` (NO ACTION) — un DELETE FROM tenants con ese tenant teniendo alguna fila
-- en autorizaciones fallaría por violación de FK. Se corrige a CASCADE, igual que el resto.
-- ============================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delete_scheduled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tenants_delete_scheduled_at
  ON public.tenants(delete_scheduled_at)
  WHERE delete_scheduled_at IS NOT NULL;

COMMENT ON COLUMN public.tenants.delete_scheduled_at IS
  'Fecha programada de borrado definitivo del tenant (hard delete, grace period 30 días). NULL = sin baja programada. El dueño puede cancelarla (self-service) mientras no se haya cumplido. Mig 358.';

ALTER TABLE public.autorizaciones
  DROP CONSTRAINT autorizaciones_inventario_tenant_id_fkey,
  ADD CONSTRAINT autorizaciones_inventario_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
