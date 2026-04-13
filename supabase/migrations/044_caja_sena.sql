-- Migration 044: Seña en caja
-- Actualiza pagar_nomina_empleado para incluir ingreso_reserva y egreso_devolucion_sena
-- en el cálculo de saldo de la sesión de caja.
-- No requiere cambios de schema (caja_movimientos.tipo es TEXT libre).

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
  IF p_medio_pago = 'efectivo' THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso', 'ingreso_reserva') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo IN ('egreso', 'egreso_devolucion_sena') THEN monto ELSE 0 END), 0)
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
