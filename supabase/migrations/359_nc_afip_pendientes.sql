-- ============================================================
-- 359_nc_afip_pendientes.sql
-- NC electrónica AFIP automática al confirmar una devolución (relevamiento Ventas A10, "auto al
-- confirmar" — GO pidió retomarlo 2026-08-13). Hoy la NC solo se emite a mano (botón "Emitir NC").
--
-- Diseño (recomendación ya escrita en relevamiento_ventas_respuestas.md → A10, ejecutada tal cual):
-- al confirmar una devolución de una venta facturada, el frontend intenta emitir la NC electrónica
-- en segundo plano (no bloquea la devolución, que ya quedó confirmada con su NC interna). Si AFIP
-- responde OK, listo — mismo resultado que el botón manual de siempre. Si falla, se encola acá para
-- que un sweep periódico (Edge Function `nc-afip-retry-sweep`, GitHub Actions cada 15 min) reintente.
--
-- 🛑 REGLA #0 — el sweep NO reintenta ciegamente cualquier error. `emitir-factura/index.ts` ya
-- marca con la frase literal "NO reintentar" los dos casos donde AFIP pudo haber autorizado el
-- comprobante aunque nosotros no tengamos el CAE (error de transporte a mitad de la llamada, o CAE
-- autorizado pero la persistencia en `devoluciones.nc_cae` falló) — reintentar ciegamente esos casos
-- puede emitir una NC DUPLICADA en AFIP. `requiere_reconciliacion_manual` marca esos casos para que
-- un humano concilie contra el "último autorizado" de AFIP antes de que se vuelva a intentar nada.
--
-- Un solo pendiente ACTIVO por devolución (índice único parcial) — evita duplicar la cola si el
-- intento automático y un click manual en "Emitir NC" fallan casi al mismo tiempo.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nc_afip_pendientes (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  devolucion_id                   uuid NOT NULL REFERENCES public.devoluciones(id) ON DELETE CASCADE,
  venta_id                        uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  tipo_comprobante                text NOT NULL,
  punto_venta                     integer NOT NULL,
  intentos                        integer NOT NULL DEFAULT 0,
  ultimo_error                    text,
  requiere_reconciliacion_manual  boolean NOT NULL DEFAULT false,
  resuelto_at                     timestamptz,
  notificado_at                   timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now()
);

-- Un pendiente activo (resuelto_at IS NULL) por devolución.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nc_afip_pendientes_devolucion_activa
  ON public.nc_afip_pendientes(devolucion_id) WHERE resuelto_at IS NULL;

-- Índice para el sweep: pendientes activos que todavía no escalaron a reconciliación manual.
CREATE INDEX IF NOT EXISTS idx_nc_afip_pendientes_para_sweep
  ON public.nc_afip_pendientes(tenant_id)
  WHERE resuelto_at IS NULL AND requiere_reconciliacion_manual = false;

COMMENT ON TABLE public.nc_afip_pendientes IS
  'Cola de reintento para NC electrónica AFIP que falló al confirmar la devolución (A10). Mig 359.';
COMMENT ON COLUMN public.nc_afip_pendientes.requiere_reconciliacion_manual IS
  'true = el sweep detectó un error "NO reintentar" (posible autorización ambigua en AFIP) y dejó de
   reintentar solo — un humano debe conciliar contra AFIP antes de emitir de nuevo.';

ALTER TABLE public.nc_afip_pendientes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nc_afip_pendientes' AND policyname = 'nc_afip_pendientes_select') THEN
    CREATE POLICY nc_afip_pendientes_select ON public.nc_afip_pendientes FOR SELECT
      USING (tenant_id = get_user_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nc_afip_pendientes' AND policyname = 'nc_afip_pendientes_insert') THEN
    CREATE POLICY nc_afip_pendientes_insert ON public.nc_afip_pendientes FOR INSERT
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

REVOKE ALL ON public.nc_afip_pendientes FROM anon;
GRANT SELECT, INSERT ON public.nc_afip_pendientes TO authenticated;
