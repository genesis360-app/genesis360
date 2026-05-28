-- Migration 145: fix pagar_nomina_empleado — saldo no contemplaba traspasos
-- Bug: la función calculaba saldo con solo (ingreso + ingreso_reserva) y
-- (egreso + egreso_devolucion_sena). La bóveda recibe dinero principalmente
-- vía ingreso_traspaso (desde cajas operativas), por lo que daba saldo 0 y
-- rechazaba la nómina con "saldo insuficiente". Mismo bug para cajas que
-- hayan recibido traspasos.
--
-- Fix: alinear con la lógica frontend ya canónica en GastosPage:
--   INGRESOS efectivos = ingreso + ingreso_reserva + ingreso_traspaso
--   EGRESOS  efectivos = egreso + egreso_devolucion_sena + egreso_traspaso
-- Los _informativo NO afectan saldo de efectivo (son tarjeta/transferencia/etc).

CREATE OR REPLACE FUNCTION public.pagar_nomina_empleado(
  p_salario_id  uuid,
  p_sesion_id   uuid,
  p_medio_pago  text DEFAULT 'efectivo'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sal      rrhh_salarios;
  v_emp      empleados;
  v_mov      UUID;
  v_apertura NUMERIC;
  v_ingresos NUMERIC;
  v_egresos  NUMERIC;
  v_saldo    NUMERIC;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;

  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  IF NOT EXISTS (
    SELECT 1 FROM caja_sesiones
    WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

  IF p_medio_pago = 'efectivo' THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso', 'ingreso_reserva', 'ingreso_traspaso') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo IN ('egreso', 'egreso_devolucion_sena', 'egreso_traspaso') THEN monto ELSE 0 END), 0)
    INTO v_ingresos, v_egresos
    FROM caja_movimientos WHERE sesion_id = p_sesion_id;
    v_saldo := COALESCE(v_apertura, 0) + v_ingresos - v_egresos;
    IF v_saldo < v_sal.neto THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponible $%, necesita $%', ROUND(v_saldo), ROUND(v_sal.neto);
    END IF;
  END IF;

  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (
    v_mov,
    v_sal.tenant_id,
    p_sesion_id,
    'egreso',
    'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'),
    v_sal.neto
  );

  UPDATE rrhh_salarios
  SET pagado = TRUE,
      fecha_pago = NOW(),
      caja_movimiento_id = v_mov,
      medio_pago = p_medio_pago,
      updated_at = NOW()
  WHERE id = p_salario_id;

  RETURN v_mov;
END;
$function$;

COMMENT ON FUNCTION public.pagar_nomina_empleado(uuid, uuid, text) IS
  'Paga una liquidación de RRHH desde la sesión de caja indicada. Si medio=efectivo, valida saldo real incluyendo traspasos (ingreso_traspaso/egreso_traspaso). Bóveda funciona como caja con es_caja_fuerte=true: recibe traspasos desde cajas operativas. Fix migration 145 — antes daba "saldo insuficiente" al pagar desde la bóveda porque ignoraba los ingreso_traspaso.';
