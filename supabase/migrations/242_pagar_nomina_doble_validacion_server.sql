-- 242 — Hardening server-side de la DOBLE VALIDACIÓN de nómina (REGLA #0, autorización sobre plata).
--
-- Contexto (barrido UAT cobertura/05 G2): el gate `puedeAprobarNomina` (RrhhPage) que decide quién puede
-- generar/pagar la nómina vivía SOLO en el frontend → bypasseable por bundle cacheado / llamada directa al
-- RPC `pagar_nomina_empleado` (que mueve plata a caja). Como el pago de nómina ES un movimiento de plata,
-- la autorización debe enforzarse en el server (igual que `registrar_pago_oc` / `marcar_envios_pagados`).
--
-- Regla (espeja `puedeAprobarNomina`): si `rrhh_nomina_doble_validacion` está ON, solo DUEÑO/ADMIN pueden
-- pagar; SUPERVISOR también si `rrhh_nomina_supervisor_aprueba` está ON. Si el flag está OFF (default),
-- cualquier rol con acceso paga (comportamiento previo intacto). El resto de la función queda igual que la
-- mig 241 (efectivo→egreso / no-efectivo→egreso_informativo + saldo de efectivo).

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
  v_rol         text := public.get_user_role();
  v_doble       boolean;
  v_super_ok    boolean;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;

  -- G2 — doble validación server-side: si el flag del tenant está activo, solo roles autorizados pagan.
  SELECT COALESCE(rrhh_nomina_doble_validacion, false), COALESCE(rrhh_nomina_supervisor_aprueba, false)
    INTO v_doble, v_super_ok
  FROM tenants WHERE id = v_sal.tenant_id;
  IF v_doble THEN
    IF NOT (v_rol IN ('DUEÑO','ADMIN') OR (v_super_ok AND v_rol = 'SUPERVISOR')) THEN
      RAISE EXCEPTION 'Requiere aprobación de DUEÑO/ADMIN (doble validación de nómina activada).'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  IF NOT EXISTS (
    SELECT 1 FROM caja_sesiones
    WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

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
  'Paga una liquidación de RRHH. Enforcea doble validación server-side (rrhh_nomina_doble_validacion → solo DUEÑO/ADMIN, o SUPERVISOR si rrhh_nomina_supervisor_aprueba). efectivo→egreso (valida saldo de efectivo, incl. traspasos); transferencia_banco/mp→egreso_informativo. Migs 145 (saldo) + 241 (medio) + 242 (doble validación server-side).';