-- Migration 091: Notificaciones automáticas diarias — CC clientes vencida + OC vencidas

CREATE OR REPLACE FUNCTION fn_notificar_cc_vencidas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
BEGIN

  -- ── 1. CC CLIENTES VENCIDAS ─────────────────────────────────────────────────
  -- Por cada tenant+cliente con deuda vencida, notifica a OWNER+ADMIN
  FOR r IN
    SELECT
      v.tenant_id,
      v.cliente_id,
      c.nombre                                         AS cliente_nombre,
      ROUND(SUM(v.total - COALESCE(v.monto_pagado, 0))::numeric, 2) AS deuda_total,
      u.id                                             AS user_id
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    JOIN users u ON u.tenant_id = v.tenant_id AND u.rol IN ('OWNER','ADMIN')
    WHERE v.es_cuenta_corriente = true
      AND v.estado IN ('despachada', 'facturada')
      AND (v.total - COALESCE(v.monto_pagado, 0)) > 0.5
      AND (v.created_at + (COALESCE(c.plazo_pago_dias, 30) || ' days')::interval)::date < CURRENT_DATE
    GROUP BY v.tenant_id, v.cliente_id, c.nombre, u.id
    HAVING SUM(v.total - COALESCE(v.monto_pagado, 0)) > 0.5
  LOOP
    -- Dedup: no insertar si ya existe notificación hoy para el mismo cliente+usuario
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
$$;

-- Cron diario a las 09:00 hora Argentina (12:00 UTC)
SELECT cron.schedule(
  'notif-cc-vencidas',
  '0 12 * * *',
  'SELECT fn_notificar_cc_vencidas()'
);
