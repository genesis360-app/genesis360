-- ============================================================
-- Migration 026: RRHH Nómina — medio_pago en rrhh_salarios
-- ============================================================

-- Agregar campo medio_pago a rrhh_salarios
ALTER TABLE rrhh_salarios
  ADD COLUMN IF NOT EXISTS medio_pago TEXT DEFAULT 'efectivo'
  CHECK (medio_pago IN ('efectivo', 'transferencia_banco', 'mp'));

-- Actualizar función pagar_nomina_empleado para aceptar p_medio_pago
CREATE OR REPLACE FUNCTION pagar_nomina_empleado(
  p_salario_id UUID,
  p_sesion_id  UUID,
  p_medio_pago TEXT DEFAULT 'efectivo'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sal rrhh_salarios; v_emp empleados; v_mov UUID;
  v_apertura NUMERIC; v_ingresos NUMERIC; v_egresos NUMERIC; v_saldo NUMERIC;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;

  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  IF NOT EXISTS (SELECT 1 FROM caja_sesiones WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta') THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

  -- Verificar saldo de caja cuando medio_pago = efectivo
  IF p_medio_pago = 'efectivo' THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo = 'egreso'   THEN monto ELSE 0 END), 0)
    INTO v_ingresos, v_egresos
    FROM caja_movimientos WHERE sesion_id = p_sesion_id;
    v_saldo := v_apertura + v_ingresos - v_egresos;
    IF v_saldo < v_sal.neto THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponible $%, necesita $%', ROUND(v_saldo), ROUND(v_sal.neto);
    END IF;
  END IF;

  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (v_mov, v_sal.tenant_id, p_sesion_id, 'egreso',
    'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'), v_sal.neto);

  UPDATE rrhh_salarios
  SET pagado = TRUE, fecha_pago = NOW(), caja_movimiento_id = v_mov,
      medio_pago = p_medio_pago, updated_at = NOW()
  WHERE id = p_salario_id;

  RETURN v_mov;
END;
$$;
