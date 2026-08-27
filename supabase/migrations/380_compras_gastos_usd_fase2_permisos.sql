-- Migration 380: Fase 2 (permisos) del plan "Compras/Gastos en USD + tasa de cambio editable"
-- (relevamiento respondido por Fede 2026-08-21, sección E1). Continúa la Fase 1 (mig 379, cimientos
-- de datos). Ver G360.Wiki/wiki/development/reglas-negocio.md.
--
-- E1 del relevamiento: de las 3 cotizaciones independientes del plan (sidebar/ventas, Bóveda,
-- Compras), la de Compras/pagos a proveedores la puede cargar el Dueño + "cualquiera con el permiso
-- habilitado en su rol — probablemente Supervisor, o roles de Finanzas/Compras". Mismo patrón ya
-- usado por cotizacion_usd_roles_permitidos (mig 370, Caja USD G5): jsonb con roles ADICIONALES a
-- DUEÑO (que siempre puede, sea cual sea lo guardado) — NULL/[] = nadie más que DUEÑO (default más
-- restrictivo y seguro). Reusa el mismo helper genérico rolEnLista() (src/lib/cajaPermisos.ts), que
-- ya soporta tanto roles base como roles custom (formato 'custom:{id}').
--
-- Esta migración es SOLO cimiento de configuración: agrega la columna nullable/default-seguro. NO
-- cambia ningún comportamiento existente por sí sola — recién se lee cuando el código de una fase
-- siguiente (UI de cotización manual en Compras) la consuma. Aditiva, sin DDL destructivo.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS compras_cotizacion_roles_permitidos jsonb;

COMMENT ON COLUMN public.tenants.compras_cotizacion_roles_permitidos IS
  'Roles ADICIONALES a DUEÑO que pueden cargar/editar la cotización manual de una compra (E1, mig 380). NULL/[] = solo DUEÑO. Formato: array de rol base o "custom:{rol_custom_id}", mismo shape que cotizacion_usd_roles_permitidos (mig 370).';
