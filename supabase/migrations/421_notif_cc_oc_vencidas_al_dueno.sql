-- 421 — Los avisos diarios de CC y OC vencidas nunca le llegaban al dueño
--
-- 🛑 `fn_notificar_cc_vencidas` (mig 091, cron diario `notif-cc-vencidas`) elegía los destinatarios con
-- `u.rol IN ('OWNER','ADMIN')`. Ninguno de los dos es el dueño de un negocio: los roles reales son DUEÑO,
-- SUPER_USUARIO, SUPERVISOR, CAJERO…; 'OWNER' no existe, y ADMIN es staff de la plataforma, no un usuario
-- del negocio. Medido el 2026-09-14: en PROD no hay NINGÚN usuario con esos roles → el aviso de cuentas
-- corrientes vencidas y de órdenes de compra vencidas sin pagar no le llegó nunca a nadie; en DEV los 58
-- avisos de "OC vencida" del último mes le llegaron solo al usuario ADMIN.
--
-- Fix: DUEÑO y SUPER_USUARIO. CREATE OR REPLACE copiado de `pg_get_functiondef` (DEV = PROD); cambian solo
-- las dos líneas de destinatarios. Se repiten SECURITY DEFINER y SET search_path (mig 413). El cron no cambia.

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
      ROUND(SUM(GREATEST(v.total - COALESCE(v.monto_pagado, 0), 0) + COALESCE(v.interes_cc, 0))::numeric, 2) AS deuda_total,
      u.id                                                                                   AS user_id
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    -- mig 421: antes ('OWNER','ADMIN'), que no incluía a ningún dueño.
    JOIN users u ON u.tenant_id = v.tenant_id AND u.rol IN ('DUEÑO','SUPER_USUARIO')
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
    -- mig 421: antes ('OWNER','ADMIN'), que no incluía a ningún dueño.
    JOIN users u ON u.tenant_id = oc.tenant_id AND u.rol IN ('DUEÑO','SUPER_USUARIO')
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
