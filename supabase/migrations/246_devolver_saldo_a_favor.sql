-- 246 — Cash-out de saldo a favor (cliente_creditos) en efectivo.
-- Cierra el gap: hasta ahora un saldo a favor SOLO se consumía aplicándolo a una venta
-- (origen 'consumo_venta'); no había forma de devolverlo en efectivo de forma asentada.
-- Relevante para cobertura legal (devolución de dinero por fallado/arrepentimiento, ver
-- wiki/features/devoluciones.md "Marco legal").
--
-- 🛑 REGLA #0 — guards server-side + atómico (una sola transacción):
--   1) monto > 0 y <= saldo a favor disponible (SUM(cliente_creditos.monto)).
--   2) la sesión de caja debe estar ABIERTA y del mismo tenant.
--   3) NO se permite caja en negativo (CAJ-18): el efectivo de la sesión debe alcanzar.
--   4) asienta el egreso de EFECTIVO en caja (tipo 'egreso', afecta el arqueo) + el
--      consumo del crédito (cliente_creditos monto negativo, origen 'retiro_efectivo').
-- El espejo de la lógica de saldo de efectivo es src/lib/cajaSaldo.ts (mismos tipos).

CREATE OR REPLACE FUNCTION devolver_saldo_a_favor(
  p_cliente_id uuid,
  p_monto      numeric,
  p_sesion_id  uuid,
  p_nota       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER                 -- RLS aísla por tenant (no hace falta SECURITY DEFINER)
SET search_path = public
AS $$
DECLARE
  v_tenant_id        uuid;
  v_cliente_nombre   text;
  v_user_id          uuid := auth.uid();
  v_saldo            numeric;
  v_apertura         numeric;
  v_efectivo         numeric;
  v_cuenta_efectivo  uuid;
  v_monto            numeric := round(COALESCE(p_monto, 0), 2);
  v_mov_id           uuid;
BEGIN
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a devolver debe ser mayor a 0.';
  END IF;

  -- Cliente (RLS garantiza que sea del tenant del usuario)
  SELECT tenant_id, nombre INTO v_tenant_id, v_cliente_nombre
  FROM clientes WHERE id = p_cliente_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado.';
  END IF;

  -- (1) Saldo a favor disponible = SUM(monto)
  SELECT COALESCE(SUM(monto), 0) INTO v_saldo
  FROM cliente_creditos
  WHERE cliente_id = p_cliente_id AND tenant_id = v_tenant_id;

  IF v_saldo < v_monto - 0.005 THEN
    RAISE EXCEPTION 'El saldo a favor disponible es $%, no podés devolver más que eso.', round(v_saldo, 2);
  END IF;

  -- (2) Sesión de caja: abierta + del tenant
  SELECT monto_apertura INTO v_apertura
  FROM caja_sesiones
  WHERE id = p_sesion_id AND tenant_id = v_tenant_id AND estado = 'abierta';
  IF v_apertura IS NULL THEN
    RAISE EXCEPTION 'La caja seleccionada no está abierta.';
  END IF;

  -- (3) Saldo de EFECTIVO de la sesión (espeja cajaSaldo.ts: apertura + ingresos − egresos efectivo)
  SELECT v_apertura + COALESCE(SUM(
           CASE
             WHEN tipo IN ('ingreso','ingreso_reserva','ingreso_traspaso') THEN monto
             WHEN tipo IN ('egreso','egreso_devolucion_sena','egreso_traspaso') THEN -monto
             ELSE 0
           END), 0)
    INTO v_efectivo
  FROM caja_movimientos
  WHERE sesion_id = p_sesion_id;

  IF v_efectivo < v_monto - 0.005 THEN
    RAISE EXCEPTION 'No hay suficiente efectivo en la caja ($%) para devolver $%. Hacé un ingreso a la caja o devolvé por otro medio.',
      round(v_efectivo, 2), v_monto;
  END IF;

  -- Cuenta de origen "Efectivo" del tenant (best-effort, para reportes de cuentas/Mix de Caja)
  SELECT cuenta_origen_id INTO v_cuenta_efectivo
  FROM metodos_pago
  WHERE tenant_id = v_tenant_id AND lower(nombre) = 'efectivo' AND cuenta_origen_id IS NOT NULL
  LIMIT 1;

  -- (4a) Egreso de efectivo en caja (afecta el arqueo)
  INSERT INTO caja_movimientos (tenant_id, sesion_id, tipo, concepto, monto, cuenta_origen_id, usuario_id)
  VALUES (v_tenant_id, p_sesion_id, 'egreso',
          'Devolución saldo a favor — ' || COALESCE(NULLIF(trim(v_cliente_nombre), ''), 'cliente'),
          v_monto, v_cuenta_efectivo, v_user_id)
  RETURNING id INTO v_mov_id;

  -- (4b) Consumo del crédito (negativo)
  INSERT INTO cliente_creditos (tenant_id, cliente_id, monto, origen, nota, usuario_id)
  VALUES (v_tenant_id, p_cliente_id, -v_monto, 'retiro_efectivo',
          COALESCE(NULLIF(trim(p_nota), ''), 'Devolución de saldo a favor en efectivo'), v_user_id);

  RETURN jsonb_build_object(
    'ok', true,
    'caja_movimiento_id', v_mov_id,
    'monto', v_monto,
    'saldo_restante', round(v_saldo - v_monto, 2)
  );
END;
$$;

-- anon NO debe poder ejecutarla. OJO: Supabase tiene DEFAULT PRIVILEGES que otorgan EXECUTE a
-- `anon` DIRECTO sobre funciones nuevas de `public`, así que REVOKE FROM PUBLIC NO alcanza →
-- hay que revocar de `anon` explícito (verificado: anon_exec pasa a false en DEV+PROD).
REVOKE EXECUTE ON FUNCTION devolver_saldo_a_favor(uuid, numeric, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION devolver_saldo_a_favor(uuid, numeric, uuid, text) TO authenticated, service_role;
