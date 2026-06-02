-- ============================================================
-- Migration 173 — Relevamiento Clientes · Fase CL3
--   B6 — Incobrables: se resuelve en app (condonación a nivel cliente + gasto
--        automático "Deudores incobrables" + clave maestra DUEÑO + audit). Sin DDL.
--   B8 — Estado de cuenta: token público por cliente + RPC anon para el portal.
-- Aditiva e idempotente. Espeja el patrón del token de transportista (mig 129).
-- ============================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cuenta_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_clientes_cuenta_token ON clientes(cuenta_token) WHERE cuenta_token IS NOT NULL;

-- Portal público del cliente: estado de cuenta sin login (SECURITY DEFINER, por token).
CREATE OR REPLACE FUNCTION get_cuenta_cliente_by_token(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cli RECORD; v_ventas JSONB; BEGIN
  SELECT c.id, c.nombre, c.telefono, c.email, c.tenant_id,
         t.nombre AS tenant_nombre, t.moneda
  INTO v_cli
  FROM clientes c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.cuenta_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'numero',      v.numero,
    'fecha',       v.created_at::date,
    'total',       v.total,
    'pagado',      v.monto_pagado,
    'saldo',       GREATEST(v.total - v.monto_pagado, 0),
    'interes',     v.interes_cc,
    'vencimiento', v.fecha_vencimiento_cc
  ) ORDER BY v.created_at)
  INTO v_ventas
  FROM ventas v
  WHERE v.cliente_id = v_cli.id
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND (v.total - v.monto_pagado) > 0.5;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('nombre', v_cli.nombre, 'telefono', v_cli.telefono, 'email', v_cli.email),
    'negocio', v_cli.tenant_nombre,
    'moneda',  COALESCE(v_cli.moneda, 'ARS'),
    'ventas',  COALESCE(v_ventas, '[]'::jsonb)
  );
END;$$;
GRANT EXECUTE ON FUNCTION get_cuenta_cliente_by_token(TEXT) TO anon, authenticated;
