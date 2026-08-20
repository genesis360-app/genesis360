-- ============================================================
-- 361_emision_factura_lock.sql
-- 🛑 REGLA #0 (FISCAL) — cierra un hallazgo real de la auditoría de performance/calidad
-- (2026-08-14): `emitir-factura` guardaba contra re-emitir un comprobante ya emitido con una
-- simple lectura ("¿venta.cae ya tiene valor?"/"¿devolucion.nc_cae ya tiene valor?") SIN
-- ningún lock — check-then-act. Dos invocaciones casi simultáneas (doble click que esquiva
-- el debounce de UI, un timeout de red seguido de un reintento del usuario, o dos pestañas)
-- podían ambas leer "sin CAE", ambas pasar el guard, y ambas llamar a AFIP — resultando en
-- DOS comprobantes fiscales reales autorizados para la misma venta/devolución.
--
-- Por qué una tabla-mutex y no `pg_advisory_xact_lock`: la Edge Function habla con Postgres
-- vía PostgREST (`supabase-js`), que no mantiene una conexión/transacción persistente entre
-- llamadas — cada `.from(...).select()/.update()` es un request HTTP independiente. Un
-- advisory lock transaccional se liberaría apenas terminara esa llamada puntual, mucho antes
-- de terminar la llamada real a AFIP. Se usa en cambio el mismo patrón que el proyecto YA usa
-- para este tipo de problema (`nc_afip_pendientes` con índice único parcial,
-- `ventas.pedido_entrega_key` con índice único parcial): una fila con PK como mutex explícito
-- entre requests HTTP — el INSERT es atómico en Postgres sin importar cuántos clientes
-- concurrentes lo intenten.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.emision_factura_locks (
  clave        text PRIMARY KEY,  -- 'fc:'||venta_id  para facturas · 'nc:'||devolucion_id para NC
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  iniciado_at  timestamptz NOT NULL DEFAULT now(),
  -- 🛑 Hallazgo del code-reviewer: si AFIP pudo haber autorizado el comprobante sin que el
  -- sistema tenga el CAE (el mensaje de error real contiene la frase literal "NO reintentar" —
  -- ver emitir-factura/index.ts y providers.ts), liberar el lock igual reabriría la misma
  -- carrera que esta tabla vino a cerrar. En ese caso la fila queda marcada acá en vez de
  -- borrarse — requiere que un humano concilie contra AFIP antes de que alguien vuelva a
  -- intentar (mismo patrón que `nc_afip_pendientes.requiere_reconciliacion_manual`).
  requiere_reconciliacion_manual boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.emision_factura_locks IS
  'Mutex explícito (mig 361) contra doble-submit de emitir-factura para el mismo venta_id/devolucion_id. Fila efímera: se borra apenas termina la emisión (éxito o error) — salvo que quede en cuarentena (requiere_reconciliacion_manual), caso en el que solo un humano la borra a mano tras conciliar con AFIP. Solo la EF (service_role) la toca.';

ALTER TABLE public.emision_factura_locks ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito (deny-by-default para anon/authenticated) — mismo patrón que
-- `afip_wsaa_ta`/`platform_facturas`: es un detalle interno de la Edge Function, que siempre
-- usa SUPABASE_SERVICE_ROLE_KEY (bypassea RLS). No hace falta exponerla a los tenants.
-- Hallazgo del migration-reviewer: RLS-sin-policy solo, sin REVOKE explícito, deja la tabla
-- expuesta en el schema de PostgREST a anon/authenticated (el GRANT default de Supabase para
-- tablas nuevas sigue vigente — no hay ALTER DEFAULT PRIVILEGES en el proyecto). afip_wsaa_ta/
-- platform_facturas (mig 261/264) SÍ hacen este REVOKE explícito — replicado acá.
REVOKE ALL ON public.emision_factura_locks FROM PUBLIC;
REVOKE ALL ON public.emision_factura_locks FROM anon;
REVOKE ALL ON public.emision_factura_locks FROM authenticated;
GRANT ALL ON public.emision_factura_locks TO service_role;
