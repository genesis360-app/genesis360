-- 478 — Número visible de la OC con el código de la sucursal ("OC-SUC1-0070") + pendiente de OCs por sucursal en la CC del proveedor (decisiones de GO 2026-10-07).
--
-- Con numeración por sucursal todas las OCs se veían "S-OC-0001": dos sucursales mostraban la MISMA etiqueta para OCs
-- distintas. Ahora, igual que los presupuestos ("PRES-SUC1-0042"), va el código de la sucursal. Si la sucursal no tiene
-- código sigue "S-OC-0070" (no cambia nada para negocios de una sola sucursal ni para los PDFs ya enviados).
-- Gemela de src/lib/ocNumero.ts (`etiquetaOC`). Lo ya guardado (descripciones de la CC, gastos) no se reescribe.

CREATE OR REPLACE FUNCTION public.fn_oc_etiqueta(p_oc_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT 'OC ' || CASE
    WHEN COALESCE(t.oc_numeracion, 'sucursal') = 'sucursal' AND o.numero_sucursal IS NOT NULL
      THEN CASE WHEN NULLIF(trim(s.codigo), '') IS NOT NULL
             THEN 'OC-' || trim(s.codigo) || '-' || lpad(o.numero_sucursal::text, 4, '0')
             ELSE 'S-OC-' || lpad(o.numero_sucursal::text, 4, '0') END
    ELSE '#' || o.numero END
  FROM ordenes_compra o
  JOIN tenants t ON t.id = o.tenant_id
  LEFT JOIN sucursales s ON s.id = o.sucursal_id AND s.tenant_id = o.tenant_id
  WHERE o.id = p_oc_id;
$function$;
REVOKE ALL ON FUNCTION public.fn_oc_etiqueta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oc_etiqueta(uuid) TO authenticated, service_role;

-- Pendiente de OCs POR SUCURSAL en el resumen de la CC del proveedor (solo informativo).
-- Decisión de GO 2026-10-07: la deuda con un proveedor es UNA del negocio (los pagos a cuenta se imputan a la OC más
-- vieja sin importar la sucursal). El desglose sirve para ver de qué sucursal es lo que falta pagar; no cambia saldos.
CREATE OR REPLACE FUNCTION public.fn_proveedor_cc_resumen(p_proveedor_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'saldo', COALESCE((
      SELECT jsonb_object_agg(moneda, saldo) FROM (
        SELECT moneda, SUM(monto) AS saldo FROM proveedor_cc_movimientos
         WHERE proveedor_id = p_proveedor_id AND tenant_id = public.get_user_tenant_id()
         GROUP BY 1) s), '{}'::jsonb),
    'pendiente_ocs', COALESCE((
      SELECT jsonb_object_agg(moneda, pendiente) FROM (
        SELECT COALESCE(o.moneda, 'ARS') AS moneda,
               SUM(public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento) AS pendiente
        FROM ordenes_compra o
        WHERE o.proveedor_id = p_proveedor_id AND o.tenant_id = public.get_user_tenant_id()
          AND o.estado NOT IN ('borrador', 'cancelada') AND o.estado_pago <> 'pagada'
          AND public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento > 0.5
        GROUP BY 1) x), '{}'::jsonb),
    -- mig 478: [{sucursal, moneda, pendiente, ocs}] — sucursal NULL = OC sin sucursal.
    'pendiente_por_sucursal', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('sucursal', sucursal, 'moneda', moneda, 'pendiente', pendiente, 'ocs', ocs)
                       ORDER BY sucursal NULLS LAST, moneda) FROM (
        SELECT s.nombre AS sucursal, COALESCE(o.moneda, 'ARS') AS moneda,
               SUM(public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento) AS pendiente, count(*) AS ocs
        FROM ordenes_compra o
        LEFT JOIN sucursales s ON s.id = o.sucursal_id AND s.tenant_id = o.tenant_id
        WHERE o.proveedor_id = p_proveedor_id AND o.tenant_id = public.get_user_tenant_id()
          AND o.estado NOT IN ('borrador', 'cancelada') AND o.estado_pago <> 'pagada'
          AND public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento > 0.5
        GROUP BY 1, 2) y), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.fn_proveedor_cc_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proveedor_cc_resumen(uuid) TO authenticated;
