-- 451 — Comprobantes compartidos por link (envío por WhatsApp del ticket, la factura y la nota de crédito)
--
-- Pedido de GO (2026-10-01): además del mail, poder mandar el ticket / la factura / la NC por WhatsApp. Hoy la API
-- oficial de WhatsApp espera la aprobación de Meta, así que se abre el chat del cliente con el mensaje armado y un LINK
-- a una página pública que muestra el comprobante y permite bajar el PDF (decisión de GO: mensaje + link al PDF).
--
-- Al compartir se guarda una FOTO de los datos del comprobante (`datos`, los mismos con los que la app arma el PDF) y la
-- página regenera el PDF (regla del proyecto: snapshot de datos, no PDF en Storage). El código es aleatorio (128 bits
-- generados en el navegador con crypto.getRandomValues; el DEFAULT de respaldo, gen_random_uuid, tiene 122) y vence a los 90 días, como el link de estado de cuenta (mig 431).
--
-- Lectura pública SOLO por código: la tabla no tiene policy de SELECT para nadie del front; `fn_comprobante_compartido`
-- (SECURITY DEFINER, EXECUTE a anon) devuelve un comprobante por su código si no venció. Crear: usuario del negocio
-- (policy de INSERT por tenant) y la venta/devolución tiene que ser de su negocio.

CREATE TABLE IF NOT EXISTS public.comprobantes_compartidos (
  token          text        PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', '') CHECK (token ~ '^[0-9a-f]{32}$'),
  tenant_id      uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo           text        NOT NULL CHECK (tipo IN ('ticket', 'factura', 'nc')),
  venta_id       uuid        REFERENCES public.ventas(id) ON DELETE CASCADE,
  devolucion_id  uuid        REFERENCES public.devoluciones(id) ON DELETE CASCADE,
  datos          jsonb       NOT NULL,
  creado_por     uuid        DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  vence_at       timestamptz NOT NULL DEFAULT now() + interval '90 days',
  CHECK (venta_id IS NOT NULL OR devolucion_id IS NOT NULL),
  CHECK (octet_length(datos::text) < 2000000)
);

CREATE INDEX IF NOT EXISTS idx_comprobantes_compartidos_tenant ON public.comprobantes_compartidos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_compartidos_venta ON public.comprobantes_compartidos (venta_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_compartidos_devolucion ON public.comprobantes_compartidos (devolucion_id);

COMMENT ON TABLE public.comprobantes_compartidos IS
  'Foto de un ticket/factura/NC compartido por link (WhatsApp). Lectura pública solo por código vía fn_comprobante_compartido.';

ALTER TABLE public.comprobantes_compartidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comprobantes_compartidos FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.comprobantes_compartidos TO authenticated;
GRANT ALL ON public.comprobantes_compartidos TO service_role;

-- INSERT: usuario del negocio, a su nombre, sobre una venta/devolución de su negocio. Una factura o NC solo se comparte
-- si YA tiene CAE (y la página pública igual muestra los datos fiscales de la base, ver abajo).
DROP POLICY IF EXISTS comprobantes_compartidos_insert ON public.comprobantes_compartidos;
CREATE POLICY comprobantes_compartidos_insert ON public.comprobantes_compartidos
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND creado_por = auth.uid()
    -- Calificado: dentro del subquery, un `tenant_id` suelto sería el de ventas/devoluciones (siempre verdadero).
    AND (comprobantes_compartidos.venta_id IS NULL OR EXISTS (
          SELECT 1 FROM public.ventas v
           WHERE v.id = comprobantes_compartidos.venta_id AND v.tenant_id = comprobantes_compartidos.tenant_id
             AND (comprobantes_compartidos.tipo <> 'factura' OR v.cae IS NOT NULL)))
    AND (comprobantes_compartidos.devolucion_id IS NULL OR EXISTS (
          SELECT 1 FROM public.devoluciones d
           WHERE d.id = comprobantes_compartidos.devolucion_id AND d.tenant_id = comprobantes_compartidos.tenant_id
             AND (comprobantes_compartidos.venta_id IS NULL OR d.venta_id = comprobantes_compartidos.venta_id)
             AND (comprobantes_compartidos.tipo <> 'nc' OR d.nc_cae IS NOT NULL)))
    AND (comprobantes_compartidos.tipo <> 'factura' OR comprobantes_compartidos.venta_id IS NOT NULL)
    AND (comprobantes_compartidos.tipo <> 'nc' OR comprobantes_compartidos.devolucion_id IS NOT NULL)
  );

-- Lectura pública por código. Devuelve NULL si no existe o venció (sin distinguir, para no dar pistas).
-- 🛑 REGLA #0: los `datos` los arma el navegador; para que nadie publique una "factura" con un CAE inventado bajo la
-- marca del negocio, los datos FISCALES salen de la base (venta / devolución), pisando los del snapshot.
CREATE OR REPLACE FUNCTION public.fn_comprobante_compartido(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'tipo', c.tipo,
           'datos', CASE c.tipo
             WHEN 'factura' THEN c.datos || jsonb_build_object(
               'cae', v.cae,
               'vencimiento_cae', coalesce(v.vencimiento_cae::text, ''),
               'tipo_comprobante', regexp_replace(coalesce(v.tipo_comprobante, 'B'), '^Factura\s+', '', 'i'),
               'numero_comprobante', coalesce(v.numero_comprobante, v.numero::text))
             WHEN 'nc' THEN c.datos || jsonb_build_object(
               'cae', d.nc_cae,
               'vencimiento_cae', coalesce(d.nc_vencimiento_cae, ''),
               'tipo_comprobante', coalesce(d.nc_tipo, 'NC-B'),
               'numero_comprobante', coalesce(d.nc_numero_comprobante, 0),
               'punto_venta', coalesce(d.nc_punto_venta, 1),
               'total', d.monto_total)
             ELSE c.datos END,
           'negocio', t.nombre,
           'vence_at', c.vence_at)
    FROM public.comprobantes_compartidos c
    JOIN public.tenants t ON t.id = c.tenant_id
    LEFT JOIN public.ventas v ON v.id = c.venta_id
    LEFT JOIN public.devoluciones d ON d.id = c.devolucion_id
   WHERE c.token = p_token
     AND p_token ~ '^[0-9a-f]{32}$'
     AND c.vence_at > now()
     AND (c.tipo <> 'factura' OR v.cae IS NOT NULL)
     AND (c.tipo <> 'nc' OR d.nc_cae IS NOT NULL);
$$;

REVOKE ALL ON FUNCTION public.fn_comprobante_compartido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_comprobante_compartido(text) TO anon, authenticated;
