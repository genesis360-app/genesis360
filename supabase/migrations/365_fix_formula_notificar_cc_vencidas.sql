-- ============================================================
-- 365_fix_formula_notificar_cc_vencidas.sql
-- Auditoría de performance/calidad (2026-08-14), ítem #5 del top 5 backend.
--
-- `fn_notificar_cc_vencidas` está MUERTA (ningún sweep activo la llama — `cron-sweeps` solo
-- invoca `recalcular_intereses_cc_all`/`liberar_reservas_vencidas_all`; el proyecto no tiene
-- pg_cron habilitado) pero calculaba la deuda de CC con la fórmula vieja
-- `SUM(v.total - COALESCE(v.monto_pagado,0))` — dos gaps reales contra la fórmula canónica de
-- `cliente_cc_estado` (`GREATEST(v.total - v.monto_pagado, 0) + v.interes_cc`, que sí usan
-- `fn_ventas_cc_guard`/`fn_pedido_generar_venta`): (1) sin el `GREATEST(...,0)`, una venta
-- sobrepagada de un cliente podía restar del total agregado de sus otras ventas con CC; (2) sin
-- sumar `v.interes_cc`, el monto quedaba subestimado en el interés acumulado. Es inofensivo hoy
-- (código inerte), pero es una trampa real si alguien la reactiva sin notar el drift.
--
-- Alcance de este fix: SOLO corregir la fórmula para que no sea un landmine. NO se wirea a
-- ningún sweep/cron — eso es una decisión de producto (¿se quiere la feature de notificación de
-- CC vencida?) que no corresponde tomar en una migración de limpieza de auditoría.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_notificar_cc_vencidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN

  -- ── 1. CC CLIENTES VENCIDAS ─────────────────────────────────────────────────
  FOR r IN
    SELECT
      v.tenant_id,
      v.cliente_id,
      c.nombre                                                                              AS cliente_nombre,
      -- Fix (mig 365): sumar interes_cc, igual que cliente_cc_estado (fuente canónica) y
      -- fn_ventas_cc_guard/fn_pedido_generar_venta — antes esta función era la única que no lo
      -- sumaba, drift real detectado en la auditoría de 2026-08-14.
      ROUND(SUM(GREATEST(v.total - COALESCE(v.monto_pagado, 0), 0) + COALESCE(v.interes_cc, 0))::numeric, 2) AS deuda_total,
      u.id                                                                                   AS user_id
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    JOIN users u ON u.tenant_id = v.tenant_id AND u.rol IN ('OWNER','ADMIN')
    WHERE v.es_cuenta_corriente = true
      AND v.estado IN ('despachada', 'facturada')
      AND (v.total - COALESCE(v.monto_pagado, 0)) > 0.5
      AND (v.created_at + (COALESCE(c.plazo_pago_dias, 30) || ' days')::interval)::date < CURRENT_DATE
    GROUP BY v.tenant_id, v.cliente_id, c.nombre, u.id
    HAVING SUM(GREATEST(v.total - COALESCE(v.monto_pagado, 0), 0) + COALESCE(v.interes_cc, 0)) > 0.5
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/clientes'
        AND titulo     LIKE '%' || r.cliente_nombre || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'warning',
        'CC vencida: ' || r.cliente_nombre,
        'Deuda vencida de $' || r.deuda_total || ' en cuenta corriente sin cobrar.',
        '/clientes'
      );
    END IF;
  END LOOP;

  -- ── 2. OC VENCIDAS SIN PAGAR ────────────────────────────────────────────────
  FOR r IN
    SELECT
      oc.tenant_id,
      oc.id         AS oc_id,
      oc.numero     AS oc_numero,
      p.nombre      AS proveedor_nombre,
      COALESCE(oc.monto_total, 0) AS monto,
      u.id          AS user_id
    FROM ordenes_compra oc
    JOIN proveedores p ON p.id = oc.proveedor_id
    JOIN users u ON u.tenant_id = oc.tenant_id AND u.rol IN ('OWNER','ADMIN')
    WHERE oc.fecha_vencimiento_pago IS NOT NULL
      AND oc.fecha_vencimiento_pago < CURRENT_DATE
      AND oc.estado_pago NOT IN ('pagada')
      AND oc.estado NOT IN ('cancelada')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones
      WHERE user_id    = r.user_id
        AND action_url = '/proveedores'
        AND titulo     LIKE '%OC #' || r.oc_numero || '%'
        AND created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO notificaciones (tenant_id, user_id, tipo, titulo, mensaje, action_url)
      VALUES (
        r.tenant_id,
        r.user_id,
        'danger',
        'OC #' || r.oc_numero || ' vencida — ' || r.proveedor_nombre,
        'Orden de compra por $' || r.monto || ' venció sin pagar.',
        '/proveedores'
      );
    END IF;
  END LOOP;

END;
$function$;

COMMENT ON FUNCTION public.fn_notificar_cc_vencidas() IS
  'Notifica CC de clientes vencida + OC de proveedores vencida sin pagar. 🟡 MUERTA: ningún sweep la invoca hoy (mig 365 solo corrigió el cálculo de deuda para sumar interes_cc, igual que cliente_cc_estado — no se wireó a ningún cron, es decisión de producto pendiente).';
