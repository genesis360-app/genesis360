-- ============================================================
-- 353_fix_security_invoker_vw_tareas_repositor.sql
-- Fix de seguridad sobre mig 352 (Repositores Fase 1), encontrado por el subagente
-- migration-reviewer al re-revisar la mig 352 (la primera vez había fallado a mitad de camino por
-- el límite de gasto mensual de la cuenta, mig 352 se había revisado a mano en su momento).
--
-- 🛑 `vw_tareas_repositor` (mig 352) quedó creada SIN `WITH (security_invoker = true)`. Por default
-- (`security_invoker = false`), Postgres evalúa las RLS policies de las tablas subyacentes con los
-- permisos del DUEÑO de la vista, no del usuario que consulta — exactamente el gotcha que este mismo
-- proyecto ya había detectado y corregido en mig 053 (`stock_por_producto`) y replicado desde
-- entonces en TODAS las vistas nuevas (136, 141, 142, 226). `vw_tareas_repositor` fue la única vista
-- del historial de migraciones que quedó afuera de ese patrón.
--
-- Impacto real (mientras estuvo así): cualquier usuario autenticado de cualquier tenant que
-- consultara la vista podía ver tareas — y por join, precios/estados de inventario/vencimientos/
-- patrones de venta — de TODOS los tenants, no solo el propio. Solo estuvo aplicada en DEV, nunca
-- en PROD.
--
-- También suma `authenticated` al REVOKE de las 2 funciones trigger de la mig 352, alineado con el
-- precedente de mig 272 (un trigger no necesita que nadie pueda invocarlo por REST/RPC; Supabase da
-- grant directo de EXECUTE a authenticated por default-privileges, independiente del REVOKE FROM
-- PUBLIC). No era explotable (son RETURNS TRIGGER, Postgres rechaza invocarlas fuera de un trigger),
-- pero el Security Advisor las seguía marcando — se corrige para no generar ruido.
-- ============================================================

ALTER VIEW public.vw_tareas_repositor SET (security_invoker = true);

COMMENT ON VIEW public.vw_tareas_repositor IS
  'tareas_repositor + los datos de prioridad C1-C3 calculados en cada lectura (nunca cacheados) — ver comentario en mig 352. WITH (security_invoker = true) desde mig 353 (fix de seguridad: sin esto, RLS se evaluaba con permisos del dueño de la vista, no del usuario — filtraba datos cross-tenant). Mig 352/353.';

REVOKE ALL ON FUNCTION public.fn_generar_tarea_repositor_precio() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_generar_tarea_repositor_estado() FROM PUBLIC, anon, authenticated;
