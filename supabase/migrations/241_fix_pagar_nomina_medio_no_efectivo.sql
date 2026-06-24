-- 241 — FIX REGLA #0 (plata que no cuadra en caja): pagar nómina por medio NO-efectivo asentaba `egreso`.
--
-- Bug detectado en el barrido UAT (cobertura/05 G1): `pagar_nomina_empleado` (mig 145) inserta SIEMPRE un
-- `caja_movimientos` tipo 'egreso' (que SÍ afecta el arqueo de efectivo), sin importar `p_medio_pago`. La UI
-- de RRHH ofrece 3 medios (efectivo / transferencia_banco / mp), así que pagar una nómina por transferencia
-- o Mercado Pago restaba del EFECTIVO de la caja plata que nunca salió del cajón → el arqueo no cuadra.
--
-- Fix (espeja registrar_pago_oc / marcar_envios_pagados): efectivo → 'egreso' (afecta efectivo);
-- no-efectivo → 'egreso_informativo' (tarjeta/transferencia/MP, NO afecta el saldo de efectivo, queda
-- como registro). El chequeo de saldo de efectivo ya estaba bien acotado a `p_medio_pago='efectivo'`.
-- Concepto de los no-efectivo prefijado con el medio, igual que el resto de los RPCs de pago.

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
  v_es_efectivo boolean := (p_medio_pago = 'efectivo');
  v_concepto text;
  v_medio_lbl text;
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

  -- El saldo de EFECTIVO solo se valida cuando se paga en efectivo (igual que antes).
  IF v_es_efectivo THEN
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

  v_concepto := 'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY');
  v_medio_lbl := CASE p_medio_pago WHEN 'transferencia_banco' THEN 'Transferencia'
                                   WHEN 'mp' THEN 'Mercado Pago' ELSE p_medio_pago END;

  v_mov := gen_random_uuid();
  -- efectivo → egreso (afecta arqueo de efectivo); no-efectivo → egreso_informativo (no afecta efectivo).
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (
    v_mov,
    v_sal.tenant_id,
    p_sesion_id,
    CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
    CASE WHEN v_es_efectivo THEN v_concepto ELSE '[' || v_medio_lbl || '] ' || v_concepto END,
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
  'Paga una liquidación de RRHH desde la sesión de caja indicada. Si medio=efectivo, valida saldo real de efectivo (incluye traspasos) y asienta egreso; si es transferencia_banco/mp asienta egreso_informativo (no afecta el arqueo de efectivo). Fix mig 241 — antes asentaba egreso para cualquier medio, descuadrando el efectivo en pagos no-efectivo.';
