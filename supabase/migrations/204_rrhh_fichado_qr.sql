-- Migration 204 — RRHH: fichado por QR público (RH6, diferido)
-- Un QR por negocio (kiosco en la entrada): el empleado abre /fichar/:token, toca su
-- nombre y queda registrada la entrada/salida (origen 'qr'). El token es el secreto
-- (mismo patrón que /transporte/:token). Las RPC son SECURITY DEFINER y se exponen a anon.

-- 1) Token de fichado por tenant (lo genera/rota el dueño desde la app)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fichado_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_fichado_token ON tenants(fichado_token) WHERE fichado_token IS NOT NULL;
COMMENT ON COLUMN tenants.fichado_token IS 'RH6: token público para el fichado por QR (/fichar/:token). NULL = QR no generado.';

-- 2) get_fichado_info(token) → nombre del negocio + empleados activos con su último fichaje de hoy
CREATE OR REPLACE FUNCTION get_fichado_info(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id UUID; v_nombre TEXT; v_empleados JSONB;
BEGIN
  SELECT id, nombre INTO v_tenant_id, v_nombre FROM tenants WHERE fichado_token = p_token;
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', e.id,
    'nombre', e.nombre,
    'apellido', e.apellido,
    'ultimo_tipo_hoy', (
      SELECT f.tipo FROM rrhh_fichadas f
      WHERE f.empleado_id = e.id AND f.ts::date = now()::date
      ORDER BY f.ts DESC LIMIT 1
    )
  ) ORDER BY e.apellido NULLS LAST, e.nombre)
  INTO v_empleados
  FROM empleados e
  WHERE e.tenant_id = v_tenant_id AND e.activo = TRUE;

  RETURN jsonb_build_object('tenant_nombre', v_nombre, 'empleados', COALESCE(v_empleados, '[]'::jsonb));
END;$$;

-- 3) fichar_qr(token, empleado_id) → registra entrada/salida (auto-toggle según el último de hoy)
CREATE OR REPLACE FUNCTION fichar_qr(p_token TEXT, p_empleado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id UUID; v_ultimo TEXT; v_tipo TEXT; v_ts TIMESTAMPTZ := now();
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE fichado_token = p_token;
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Token inválido'); END IF;

  -- el empleado debe pertenecer al tenant y estar activo
  IF NOT EXISTS (SELECT 1 FROM empleados WHERE id = p_empleado_id AND tenant_id = v_tenant_id AND activo = TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Empleado no válido');
  END IF;

  -- auto-toggle: si el último fichaje de hoy fue entrada → salida; si no → entrada
  SELECT tipo INTO v_ultimo FROM rrhh_fichadas
  WHERE empleado_id = p_empleado_id AND ts::date = v_ts::date
  ORDER BY ts DESC LIMIT 1;
  v_tipo := CASE WHEN v_ultimo = 'entrada' THEN 'salida' ELSE 'entrada' END;

  INSERT INTO rrhh_fichadas (tenant_id, empleado_id, tipo, ts, origen)
  VALUES (v_tenant_id, p_empleado_id, v_tipo, v_ts, 'qr');

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'ts', v_ts);
END;$$;

GRANT EXECUTE ON FUNCTION get_fichado_info(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fichar_qr(TEXT, UUID) TO anon, authenticated;
