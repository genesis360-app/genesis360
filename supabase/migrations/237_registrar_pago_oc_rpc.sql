-- 237 — RPC atómico y clave-gated para registrar el pago de una OC (REGLA #0 obligación #3).
--
-- Contexto (H2, tests/specs/uat-app.md): el pago de OC sobre el umbral exigía clave maestra SOLO si el
-- tenant tenía clave seteada (si no, el pago grande pasaba sin segunda firma, en silencio), y todo el
-- enforcement + las escrituras vivían en el frontend (GastosPage.registrarPagoOC), bypasseable por bundle
-- cacheado / API. Este RPC SECURITY DEFINER mueve la decisión y las escrituras al server, atómicas:
--   - rol (no CONTADOR) + doble firma (clave) cuando el pago supera el umbral, CERRANDO el hueco
--     "se omite si no hay clave" → si supera el umbral y el tenant NO tiene clave, BLOQUEA y pide configurarla.
--   - saldo no excedible.
--   - escrituras: OC (estado_pago/monto_pagado/descuento/fechas CC) + proveedor_cc_movimientos (pago y/o oc)
--     + cheque (si paga con Cheque) + caja_movimientos (egreso/egreso_informativo por medio no-CC).
--
-- El frontend conserva los pre-checks de UX (medios válidos, selección de caja, fecha de cobro del cheque,
-- bloqueo CC del proveedor → modal de solicitud) y pasa los medios ya enriquecidos con cuenta_origen_id
-- (resuelto con la normalización de nombres del cliente) + el descuento ya resuelto a monto.
--
-- SECURITY DEFINER ⇒ todo se scopea por v_tenant (la RLS no protege adentro): la OC y la caja_sesion se
-- validan pertenecientes al tenant antes de escribir.
--
-- p_medios: [{ "tipo": "Efectivo"|"Transferencia"|"Cheque"|"Cuenta Corriente"|..., "monto": n,
--             "cuenta_origen_id": uuid|null }]
-- p_cheque: { "nro": text|null, "banco": text|null, "fecha_cobro": "YYYY-MM-DD", "sucursal_id": uuid|null } | null
-- Devuelve jsonb { ok, estado_pago, monto_pagado, monto_cheque }.

CREATE OR REPLACE FUNCTION public.registrar_pago_oc(
  p_oc_id uuid,
  p_medios jsonb,
  p_descuento_monto numeric DEFAULT 0,
  p_clave text DEFAULT NULL,
  p_caja_sesion_id uuid DEFAULT NULL,
  p_cheque jsonb DEFAULT NULL,
  p_pago_dias int DEFAULT 30,
  p_pago_condiciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_tenant      uuid := public.get_user_tenant_id();
  v_rol         text := public.get_user_role();
  v_user        uuid := auth.uid();
  v_eps         numeric := 0.5;
  v_oc          record;
  v_prov_nombre text;
  v_total       numeric;
  v_montocc     numeric := 0;
  v_montonocc   numeric := 0;
  v_montototal  numeric;
  v_montocheque numeric := 0;
  v_descuento   numeric := COALESCE(p_descuento_monto, 0);
  v_saldo       numeric;
  v_umbral      numeric;
  v_clave_real  text;
  v_nuevo_pagado    numeric;
  v_nuevo_descuento numeric;
  v_nuevo_estado    text;
  v_fecha_venc  date;
  v_dias        int;
  v_medio       jsonb;
  v_medios_nocc jsonb;
  v_concepto    text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS NULL OR v_rol = 'CONTADOR' THEN
    RAISE EXCEPTION 'No autorizado: el CONTADOR tiene acceso de solo lectura — no puede registrar pagos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_medios IS NULL OR jsonb_typeof(p_medios) <> 'array' THEN RAISE EXCEPTION 'Medios de pago inválidos'; END IF;

  SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = p_oc_id AND tenant_id = v_tenant;
  IF v_oc.id IS NULL THEN RAISE EXCEPTION 'OC no encontrada en el tenant'; END IF;
  SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_oc.proveedor_id AND tenant_id = v_tenant;

  -- total = COALESCE(monto_total, Σ items) — espeja calcMontoTotalOC
  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE oc_id = p_oc_id;
  END IF;

  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montonocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocheque
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cheque';
  v_montototal := v_montocc + v_montonocc;
  IF v_montototal <= v_eps THEN RAISE EXCEPTION 'Ingresá al menos un monto válido'; END IF;

  -- caja del tenant (defensivo: no escribir en sesión de otro tenant)
  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

  -- D5 — doble firma server-side: si supera el umbral, exige clave; si el tenant NO tiene clave, BLOQUEA.
  v_umbral := (SELECT oc_pago_doble_firma_umbral FROM public.tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_montototal >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_montototal), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- saldo no excedible
  v_saldo := v_total - COALESCE(v_oc.monto_pagado,0) - COALESCE(v_oc.monto_descuento,0) - v_descuento;
  IF v_montototal > v_saldo + v_eps THEN
    RAISE EXCEPTION 'El monto $% supera el saldo de $%.', round(v_montototal), round(v_saldo) USING ERRCODE = 'check_violation';
  END IF;

  v_nuevo_pagado    := COALESCE(v_oc.monto_pagado,0) + v_montonocc;
  v_nuevo_descuento := COALESCE(v_oc.monto_descuento,0) + v_descuento;
  IF (v_nuevo_pagado + v_montocc + v_nuevo_descuento) >= v_total - v_eps THEN
    v_nuevo_estado := CASE WHEN v_montocc > 0 AND v_montonocc = 0 THEN 'cuenta_corriente' ELSE 'pagada' END;
  ELSE
    v_nuevo_estado := 'pago_parcial';
  END IF;

  IF v_montocc > 0 THEN
    v_dias := COALESCE(p_pago_dias, 30);
    v_fecha_venc := CURRENT_DATE + v_dias;
    UPDATE public.ordenes_compra SET
      estado_pago = v_nuevo_estado, monto_pagado = v_nuevo_pagado, monto_descuento = v_nuevo_descuento,
      monto_total = v_total, fecha_vencimiento_pago = v_fecha_venc, dias_plazo_pago = v_dias,
      condiciones_pago = NULLIF(p_pago_condiciones, '')
    WHERE id = p_oc_id AND tenant_id = v_tenant;
  ELSE
    UPDATE public.ordenes_compra SET
      estado_pago = v_nuevo_estado, monto_pagado = v_nuevo_pagado, monto_descuento = v_nuevo_descuento,
      monto_total = v_total
    WHERE id = p_oc_id AND tenant_id = v_tenant;
  END IF;

  -- proveedor_cc_movimientos: pago (cancela deuda con lo no-CC)
  IF v_montonocc > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('tipo', e->>'tipo', 'monto', (e->>'monto')::numeric))
      INTO v_medios_nocc FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, medio_pago, descripcion, caja_sesion_id, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'pago', -v_montonocc, CURRENT_DATE, v_medios_nocc::text,
            'Pago OC #'||v_oc.numero, p_caja_sesion_id, v_user);
  END IF;
  -- proveedor_cc_movimientos: oc (suma nueva deuda CC)
  IF v_montocc > 0 THEN
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, fecha_vencimiento, descripcion, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'oc', v_montocc, CURRENT_DATE, v_fecha_venc,
            'CC OC #'||v_oc.numero||' — '||v_dias||'d', v_user);
  END IF;

  -- cheque entregado (si pagó con Cheque)
  IF v_montocheque > 0 AND p_cheque IS NOT NULL THEN
    INSERT INTO public.cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, oc_id, sucursal_id, notas, created_by)
    VALUES (v_tenant, 'propio', 'entregado', v_montocheque,
            NULLIF(p_cheque->>'nro',''), NULLIF(p_cheque->>'banco',''), CURRENT_DATE,
            NULLIF(p_cheque->>'fecha_cobro','')::date, v_oc.proveedor_id, p_oc_id,
            NULLIF(p_cheque->>'sucursal_id','')::uuid, 'Generado por pago OC #'||v_oc.numero, v_user);
  END IF;

  -- caja: un egreso por cada medio no-CC (efectivo → egreso; otros → egreso_informativo). Solo si hay caja.
  IF p_caja_sesion_id IS NOT NULL THEN
    v_concepto := 'Pago OC #'||v_oc.numero||' — '||COALESCE(v_prov_nombre,'');
    FOR v_medio IN SELECT e FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente'
    LOOP
      INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id)
      VALUES (v_tenant, p_caja_sesion_id,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN 'egreso' ELSE 'egreso_informativo' END,
              (v_medio->>'monto')::numeric,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN v_concepto ELSE '['||(v_medio->>'tipo')||'] '||v_concepto END,
              CASE WHEN v_medio->>'tipo' = 'Efectivo' THEN NULL ELSE NULLIF(v_medio->>'cuenta_origen_id','')::uuid END,
              v_user);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$;

REVOKE ALL ON FUNCTION public.registrar_pago_oc(uuid,jsonb,numeric,text,uuid,jsonb,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_oc(uuid,jsonb,numeric,text,uuid,jsonb,int,text) TO authenticated;
