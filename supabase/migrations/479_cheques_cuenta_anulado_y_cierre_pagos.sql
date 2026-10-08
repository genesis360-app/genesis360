-- 479 — Cheques propios: contramovimiento en la cuenta bancaria, el ANULADO revierte igual que el rechazo, y el cierre
-- contable no bloquea pagos ni reversiones (decisiones de GO 2026-10-08 sobre las recomendaciones; criterio contable
-- provisorio → consultas al contador C-23 a C-25).
--
-- 1. Cuenta bancaria: el pago con cheque deja un `egreso_informativo` que RESTA del saldo de la cuenta asignada al medio
--    Cheque (vw_boveda_cuentas). Si el cheque rebota o se anula, la plata nunca salió → `ingreso_informativo` de hoy a la
--    misma cuenta. Para saber cuál, el cheque guarda su movimiento de caja (`cheques.caja_movimiento_id`).
-- 2. Cheque propio ANULADO después de entregado: no se cobró → la deuda sigue (pago "pro solvendo"). Se revierte igual
--    que un rechazo (`revertir_cheque_propio(id, 'anulado')`). Anulado en cartera (nunca entregado): no revierte nada.
-- 3. Cierre contable: protegía la OC/gasto por su fecha de creación y bloqueaba también PAGARLOS hoy o revertir un pago.
--    Ahora las columnas de pago quedan afuera del bloqueo (el contenido sigue protegido).
-- Funciones = definición VIGENTE (schema_full tras mig 477-478) con solo lo marcado "mig 479".

ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS caja_movimiento_id uuid REFERENCES public.caja_movimientos(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.registrar_pago_oc(p_oc_id uuid, p_medios jsonb, p_descuento_monto numeric DEFAULT 0, p_clave text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_cheque jsonb DEFAULT NULL::jsonb, p_pago_dias integer DEFAULT 30, p_pago_condiciones text DEFAULT NULL::text, p_cotizacion_usd numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
  v_es_efectivo boolean;
  v_moneda_medio text;
  v_moneda_oc    text;
  v_medios_enriquecidos jsonb := '[]'::jsonb;
  v_monto_oc     numeric;
  v_mov_id       uuid;
  v_montocheque_oc numeric := 0;
  v_cheque_id    uuid;            -- mig 479
  v_caja_mov_id  uuid;            -- mig 479   -- mig 477: lo que el cheque imputó, en la moneda de la OC (lo que se revierte si rebota)
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS NULL OR v_rol = 'CONTADOR' THEN
    RAISE EXCEPTION 'No autorizado: el CONTADOR tiene acceso de solo lectura — no puede registrar pagos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- mig 473: mismo gate que la escritura de la CC de proveedores (policy de mig 405) y que registrar_pago_proveedor.
  IF NOT public.auth_puede_editar_modulo('gastos') THEN
    RAISE EXCEPTION 'No autorizado para registrar pagos a proveedores.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_medios IS NULL OR jsonb_typeof(p_medios) <> 'array' THEN RAISE EXCEPTION 'Medios de pago inválidos'; END IF;
  IF v_descuento < 0 THEN RAISE EXCEPTION 'El descuento no puede ser negativo' USING ERRCODE = 'check_violation'; END IF;

  -- mig 473: FOR UPDATE — dos pagos simultáneos de la misma OC se serializan y el segundo ve el saldo nuevo.
  SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = p_oc_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_oc.id IS NULL THEN RAISE EXCEPTION 'OC no encontrada en el tenant'; END IF;
  IF v_oc.estado = 'cancelada' THEN   -- un borrador se puede pagar (Gastos lo ofrece; e2e 140)
    RAISE EXCEPTION 'La % está %: no se le registran pagos.', public.fn_oc_etiqueta(v_oc.id), v_oc.estado USING ERRCODE = 'check_violation';
  END IF;
  SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_oc.proveedor_id AND tenant_id = v_tenant;
  v_moneda_oc := COALESCE(v_oc.moneda, 'ARS');

  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE orden_compra_id = p_oc_id;
    -- mig 475: el envío que cobra el proveedor va en su factura → suma al total a pagarle.
    IF v_oc.tiene_envio AND v_oc.envio_a_cargo = 'proveedor' THEN
      v_total := v_total + GREATEST(COALESCE(v_oc.costo_envio, 0), 0);
    END IF;
  END IF;

  FOR v_medio IN SELECT e FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente'
  LOOP
    IF (v_medio->>'monto')::numeric < 0 THEN RAISE EXCEPTION 'Monto negativo en "%"', v_medio->>'tipo' USING ERRCODE = 'check_violation'; END IF;
    SELECT moneda INTO v_moneda_medio FROM public.metodos_pago WHERE tenant_id = v_tenant AND nombre = v_medio->>'tipo';
    v_moneda_medio := COALESCE(v_moneda_medio, 'ARS');
    IF v_moneda_medio = v_moneda_oc THEN
      v_monto_oc := (v_medio->>'monto')::numeric;
    ELSE
      IF p_cotizacion_usd IS NULL OR p_cotizacion_usd <= 0 THEN
        RAISE EXCEPTION 'El medio "%" está en % pero esta OC es en % — falta la cotización para convertir.',
          v_medio->>'tipo', v_moneda_medio, v_moneda_oc USING ERRCODE = 'check_violation';
      END IF;
      v_monto_oc := CASE WHEN v_moneda_medio = 'ARS'
        THEN (v_medio->>'monto')::numeric / p_cotizacion_usd
        ELSE (v_medio->>'monto')::numeric * p_cotizacion_usd
      END;
    END IF;
    v_medios_enriquecidos := v_medios_enriquecidos || jsonb_build_object(
      'tipo', v_medio->>'tipo', 'monto', (v_medio->>'monto')::numeric, 'monto_oc', v_monto_oc,
      'moneda', v_moneda_medio, 'cuenta_origen_id', v_medio->>'cuenta_origen_id'
    );
  END LOOP;

  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cuenta Corriente';
  IF v_montocc < 0 THEN RAISE EXCEPTION 'Monto negativo en Cuenta Corriente' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(SUM((e->>'monto_oc')::numeric),0) INTO v_montonocc
    FROM jsonb_array_elements(v_medios_enriquecidos) e;
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocheque
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cheque';
  SELECT COALESCE(SUM((e->>'monto_oc')::numeric),0) INTO v_montocheque_oc
    FROM jsonb_array_elements(v_medios_enriquecidos) e WHERE e->>'tipo' = 'Cheque';
  v_montototal := v_montocc + v_montonocc;
  IF v_montototal <= v_eps THEN RAISE EXCEPTION 'Ingresá al menos un monto válido'; END IF;

  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

  -- La doble firma mira la plata que SALE (lo que queda a plazo no se paga hoy).
  v_umbral := (SELECT oc_pago_doble_firma_umbral FROM public.tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_montonocc >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_montonocc), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  v_saldo := v_total - COALESCE(v_oc.monto_pagado,0) - COALESCE(v_oc.monto_descuento,0) - v_descuento;
  IF v_montototal > v_saldo + v_eps THEN
    RAISE EXCEPTION 'El monto $% supera el saldo de $%.', round(v_montototal), round(v_saldo) USING ERRCODE = 'check_violation';
  END IF;

  v_nuevo_pagado    := COALESCE(v_oc.monto_pagado,0) + v_montonocc;
  v_nuevo_descuento := COALESCE(v_oc.monto_descuento,0) + v_descuento;
  -- mig 473: "pagada" solo si se pagó de verdad. Lo que queda a plazo (Cuenta Corriente) sigue siendo deuda.
  IF v_nuevo_pagado + v_nuevo_descuento >= v_total - v_eps THEN
    v_nuevo_estado := 'pagada';
  ELSIF v_montocc > 0 OR v_oc.estado_pago = 'cuenta_corriente' THEN
    v_nuevo_estado := 'cuenta_corriente';
  ELSIF v_nuevo_pagado + v_nuevo_descuento > v_eps THEN
    v_nuevo_estado := 'pago_parcial';
  ELSE
    v_nuevo_estado := 'pendiente_pago';
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

  IF v_montonocc > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('tipo', e->>'tipo', 'monto', (e->>'monto')::numeric))
      INTO v_medios_nocc FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, medio_pago, descripcion, caja_sesion_id, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'pago', -v_montonocc, v_moneda_oc, CURRENT_DATE, v_medios_nocc::text,
            'Pago '||public.fn_oc_etiqueta(v_oc.id), p_caja_sesion_id, v_user)
    RETURNING id INTO v_mov_id;
    INSERT INTO public.proveedor_pago_imputaciones(tenant_id, movimiento_id, oc_id, monto)
    VALUES (v_tenant, v_mov_id, p_oc_id, round(v_montonocc, 2));
  END IF;
  -- mig 473: el descuento que se le saca a la OC también baja la deuda con el proveedor (si no, la OC queda pagada y
  -- la CC con saldo para siempre).
  IF v_descuento > 0 THEN
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, descripcion, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'ajuste', -round(v_descuento, 2), v_moneda_oc, CURRENT_DATE,
            'Descuento '||public.fn_oc_etiqueta(v_oc.id), v_user);
  END IF;
  -- mig 473: "Cuenta Corriente" ya NO inserta un cargo: la deuda la carga la recepción (fn_cc_proveedor_cargo_recepcion).

  IF v_montocheque > 0 AND p_cheque IS NOT NULL THEN
    -- mig 477: el cheque queda atado al pago (cc_movimiento_id) y guarda lo que imputó en la moneda de la OC.
    INSERT INTO public.cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, oc_id, sucursal_id, notas, created_by,
                               cc_movimiento_id, monto_imputado)
    VALUES (v_tenant, 'propio', 'entregado', v_montocheque,
            NULLIF(p_cheque->>'nro',''), NULLIF(p_cheque->>'banco',''), CURRENT_DATE,
            NULLIF(p_cheque->>'fecha_cobro','')::date, v_oc.proveedor_id, p_oc_id,
            NULLIF(p_cheque->>'sucursal_id','')::uuid, 'Generado por pago '||public.fn_oc_etiqueta(v_oc.id), v_user,
            v_mov_id, round(v_montocheque_oc, 2))
    RETURNING id INTO v_cheque_id;
  END IF;

  IF p_caja_sesion_id IS NOT NULL THEN
    v_concepto := 'Pago '||public.fn_oc_etiqueta(v_oc.id)||' — '||COALESCE(v_prov_nombre,'');
    FOR v_medio IN SELECT e FROM jsonb_array_elements(v_medios_enriquecidos) e
    LOOP
      SELECT es_efectivo INTO v_es_efectivo FROM public.metodos_pago WHERE tenant_id = v_tenant AND nombre = v_medio->>'tipo';
      v_es_efectivo := COALESCE(v_es_efectivo, false);
      INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda, cotizacion_usd)
      VALUES (v_tenant, p_caja_sesion_id,
              CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
              (v_medio->>'monto')::numeric,
              CASE WHEN v_es_efectivo THEN v_concepto ELSE '['||(v_medio->>'tipo')||'] '||v_concepto END,
              CASE WHEN v_es_efectivo THEN NULL ELSE NULLIF(v_medio->>'cuenta_origen_id','')::uuid END,
              v_user, v_medio->>'moneda',
              CASE WHEN v_medio->>'moneda' = v_moneda_oc THEN NULL ELSE p_cotizacion_usd END)
      RETURNING id INTO v_caja_mov_id;
      -- mig 479: el cheque recuerda su movimiento de caja (si rebota o se anula, se devuelve a la cuenta).
      IF v_medio->>'tipo' = 'Cheque' AND v_cheque_id IS NOT NULL THEN
        UPDATE public.cheques SET caja_movimiento_id = v_caja_mov_id WHERE id = v_cheque_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_proveedor_id uuid, p_medio text, p_monto numeric, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_clave text DEFAULT NULL::text, p_cheque jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.get_user_tenant_id();
  v_rol      text := public.get_user_role();
  v_user     uuid := auth.uid();
  v_eps      numeric := 0.5;
  v_monto    numeric := round(COALESCE(p_monto, 0), 2);
  v_moneda   text;
  v_efectivo boolean;
  v_cuenta   uuid;
  v_prov     text;
  v_pend     numeric;
  v_resto    numeric;
  v_aplica   numeric;
  v_oc       record;
  v_mov_id   uuid := gen_random_uuid();
  v_detalle  text := '';
  v_imput    jsonb := '[]'::jsonb;
  v_deuda    numeric;
  v_tope     numeric;
  v_umbral   numeric;
  v_clave_real text;
  v_es_cheque boolean := p_medio = 'Cheque';   -- mig 477
  v_cheque_id uuid;                            -- mig 479
  v_caja_mov_id uuid;                          -- mig 479
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS NULL OR v_rol = 'CONTADOR' THEN
    RAISE EXCEPTION 'No autorizado: el CONTADOR tiene acceso de solo lectura — no puede registrar pagos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.auth_puede_editar_modulo('gastos') THEN
    RAISE EXCEPTION 'No autorizado para registrar pagos a proveedores.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'Ingresá un monto válido' USING ERRCODE = 'check_violation'; END IF;
  IF COALESCE(trim(p_medio), '') = '' OR p_medio = 'Cuenta Corriente' THEN
    RAISE EXCEPTION 'Elegí con qué se paga' USING ERRCODE = 'check_violation';
  END IF;
  -- mig 477: con cheque, la fecha de cobro es obligatoria (alimenta la alerta de cheques, igual que en Gastos).
  IF v_es_cheque AND NULLIF(p_cheque->>'fecha_cobro', '') IS NULL THEN
    RAISE EXCEPTION 'Pagás con cheque: indicá la fecha de cobro.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT nombre INTO v_prov FROM proveedores WHERE id = p_proveedor_id AND tenant_id = v_tenant;
  IF v_prov IS NULL THEN RAISE EXCEPTION 'Proveedor no encontrado en el negocio'; END IF;

  SELECT COALESCE(moneda, 'ARS'), es_efectivo, cuenta_origen_id INTO v_moneda, v_efectivo, v_cuenta
    FROM metodos_pago WHERE tenant_id = v_tenant AND nombre = p_medio;
  v_moneda := COALESCE(v_moneda, 'ARS');
  v_efectivo := COALESCE(v_efectivo, p_medio = 'Efectivo');

  -- 🛑 REGLA #0: todo efectivo se asienta en caja — sin caja abierta no hay pago en efectivo.
  IF v_efectivo AND p_caja_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Para pagar en efectivo tiene que haber una caja abierta.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_caja_sesion_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant AND cerrada_at IS NULL) THEN
    RAISE EXCEPTION 'La caja elegida no está abierta en este negocio.' USING ERRCODE = 'check_violation';
  END IF;

  v_umbral := (SELECT oc_pago_doble_firma_umbral FROM tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_monto >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_monto), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Lock en el MISMO orden que el FIFO (sin orden, dos pagos concurrentes podían trabarse entre sí).
  PERFORM 1 FROM ordenes_compra
   WHERE proveedor_id = p_proveedor_id AND tenant_id = v_tenant AND COALESCE(moneda, 'ARS') = v_moneda
     AND estado NOT IN ('borrador', 'cancelada') AND estado_pago <> 'pagada'
   ORDER BY created_at, numero, id
   FOR UPDATE;
  SELECT COALESCE(SUM(public.fn_oc_total(id) - monto_pagado - monto_descuento), 0) INTO v_pend
    FROM ordenes_compra
   WHERE proveedor_id = p_proveedor_id AND tenant_id = v_tenant AND COALESCE(moneda, 'ARS') = v_moneda
     AND estado NOT IN ('borrador', 'cancelada') AND estado_pago <> 'pagada'
     AND public.fn_oc_total(id) - monto_pagado - monto_descuento > 0;
  SELECT COALESCE(SUM(monto), 0) INTO v_deuda FROM proveedor_cc_movimientos
   WHERE proveedor_id = p_proveedor_id AND tenant_id = v_tenant AND moneda = v_moneda;
  -- Tope: lo pendiente de las OCs o la deuda (lo recibido puede costar más que la OC), lo que sea mayor.
  v_tope := GREATEST(v_pend, v_deuda);
  IF v_monto > v_tope + v_eps THEN
    RAISE EXCEPTION 'El pago ($%) supera lo que se le debe a este proveedor en % ($%).',
      v_monto, v_moneda, round(GREATEST(v_tope, 0), 2) USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO proveedor_cc_movimientos(id, tenant_id, proveedor_id, tipo, monto, moneda, fecha, medio_pago, descripcion, caja_sesion_id, created_by)
  VALUES (v_mov_id, v_tenant, p_proveedor_id, 'pago', -v_monto, v_moneda, CURRENT_DATE,
          jsonb_build_array(jsonb_build_object('tipo', p_medio, 'monto', v_monto))::text,
          'Pago a cuenta', p_caja_sesion_id, v_user);

  -- Imputación: la OC más vieja primero (pedido de GO 06/10).
  v_resto := v_monto;
  FOR v_oc IN
    SELECT id, numero, public.fn_oc_total(id) AS total, monto_pagado, monto_descuento, estado_pago
      FROM ordenes_compra
     WHERE proveedor_id = p_proveedor_id AND tenant_id = v_tenant AND COALESCE(moneda, 'ARS') = v_moneda
       AND estado NOT IN ('borrador', 'cancelada') AND estado_pago <> 'pagada'
       AND public.fn_oc_total(id) - monto_pagado - monto_descuento > 0
     ORDER BY created_at, numero, id
  LOOP
    EXIT WHEN v_resto <= 0;
    v_aplica := LEAST(v_resto, v_oc.total - v_oc.monto_pagado - v_oc.monto_descuento);
    UPDATE ordenes_compra SET
      monto_total = v_oc.total,          -- queda fijo desde el primer pago (como en registrar_pago_oc)
      monto_pagado = monto_pagado + v_aplica,
      estado_pago = CASE
        WHEN monto_pagado + v_aplica + monto_descuento >= v_oc.total - v_eps THEN 'pagada'
        WHEN estado_pago = 'cuenta_corriente' THEN 'cuenta_corriente'
        ELSE 'pago_parcial' END
    WHERE id = v_oc.id;
    INSERT INTO proveedor_pago_imputaciones(tenant_id, movimiento_id, oc_id, monto) VALUES (v_tenant, v_mov_id, v_oc.id, v_aplica);
    v_imput := v_imput || jsonb_build_object('oc_id', v_oc.id, 'numero', v_oc.numero, 'etiqueta', public.fn_oc_etiqueta(v_oc.id), 'monto', v_aplica);
    v_detalle := v_detalle || CASE WHEN v_detalle = '' THEN '' ELSE ', ' END
              || public.fn_oc_etiqueta(v_oc.id) || ' $' || translate(to_char(v_aplica, 'FM999,999,990.00'), ',.', '.,');
    v_resto := v_resto - v_aplica;
  END LOOP;
  -- Lo que no tiene OC (deuda por encima de lo pedido) queda como pago a cuenta sin imputar.
  IF v_resto > v_eps THEN
    v_detalle := v_detalle || CASE WHEN v_detalle = '' THEN '' ELSE ', ' END
              || 'sin OC $' || translate(to_char(v_resto, 'FM999,999,990.00'), ',.', '.,');
  END IF;
  UPDATE proveedor_cc_movimientos SET descripcion = 'Pago a cuenta — ' || v_detalle WHERE id = v_mov_id;

  -- mig 477: el cheque entregado queda registrado (Gastos → Cheques) y atado a este pago: si rebota, se revierte
  -- exactamente lo que imputó (rechazar_cheque_propio). Antes no se creaba.
  IF v_es_cheque THEN
    INSERT INTO cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, sucursal_id, notas, created_by,
                        cc_movimiento_id, monto_imputado)
    VALUES (v_tenant, 'propio', 'entregado', v_monto, NULLIF(p_cheque->>'nro', ''), NULLIF(p_cheque->>'banco', ''), CURRENT_DATE,
            (p_cheque->>'fecha_cobro')::date, p_proveedor_id, NULLIF(p_cheque->>'sucursal_id', '')::uuid,
            'Generado por pago a cuenta de ' || v_prov, v_user, v_mov_id, v_monto)
    RETURNING id INTO v_cheque_id;
  END IF;

  IF p_caja_sesion_id IS NOT NULL THEN
    INSERT INTO caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda)
    VALUES (v_tenant, p_caja_sesion_id, CASE WHEN v_efectivo THEN 'egreso' ELSE 'egreso_informativo' END, v_monto,
            CASE WHEN v_efectivo THEN '' ELSE '[' || p_medio || '] ' END || 'Pago a ' || v_prov || ' — ' || v_detalle,
            CASE WHEN v_efectivo THEN NULL ELSE v_cuenta END, v_user, v_moneda)
    RETURNING id INTO v_caja_mov_id;
    IF v_cheque_id IS NOT NULL THEN   -- mig 479: el cheque recuerda su movimiento de caja
      UPDATE cheques SET caja_movimiento_id = v_caja_mov_id WHERE id = v_cheque_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'movimiento_id', v_mov_id, 'imputaciones', v_imput);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revertir_cheque_propio(p_cheque_id uuid, p_estado text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_rol     text := public.get_user_role();
  v_user    uuid := auth.uid();
  v_eps     numeric := 0.5;
  v_chq     record;
  v_oc      record;
  v_g       record;
  v_resto   numeric;
  v_aplica  numeric;
  v_ajuste  uuid := gen_random_uuid();
  v_moneda  text;
  v_prov    uuid;
  v_ocs     jsonb := '[]'::jsonb;
  v_detalle text := '';
  v_gasto   jsonb := NULL;
  v_cm      record;        -- mig 479: movimiento de caja del pago con cheque
  v_ses     uuid;
  v_fuerte  uuid;
  v_caja    jsonb := NULL;
  v_que     text := CASE p_estado WHEN 'anulado' THEN 'anulado' ELSE 'rechazado' END;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS NULL OR v_rol = 'CONTADOR' THEN
    RAISE EXCEPTION 'No autorizado: el CONTADOR tiene acceso de solo lectura.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.auth_puede_editar_modulo('gastos') THEN
    RAISE EXCEPTION 'No autorizado para rechazar o anular cheques.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('rechazado', 'anulado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_chq FROM cheques WHERE id = p_cheque_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_chq.id IS NULL THEN RAISE EXCEPTION 'Cheque no encontrado en el negocio'; END IF;
  IF v_chq.tipo <> 'propio' THEN RAISE EXCEPTION 'Solo se revierten por acá los cheques propios.' USING ERRCODE = 'check_violation'; END IF;
  IF v_chq.estado IN ('rechazado', 'anulado') THEN RAISE EXCEPTION 'El cheque ya está %.', v_chq.estado USING ERRCODE = 'check_violation'; END IF;
  IF v_chq.estado <> 'entregado' THEN
    RAISE EXCEPTION 'Solo se puede marcar % un cheque entregado (este está %).', v_que, v_chq.estado USING ERRCODE = 'check_violation';
  END IF;

  -- Lo que se revierte: lo que el cheque imputó, en la moneda de la OC/CC. Cheques anteriores a la mig 477: su monto
  -- (mismo criterio que la pantalla hasta hoy).
  v_resto := round(COALESCE(v_chq.monto_imputado, v_chq.monto, 0), 2);

  IF v_chq.cc_movimiento_id IS NOT NULL OR v_chq.oc_id IS NOT NULL THEN
    IF v_chq.cc_movimiento_id IS NOT NULL THEN
      SELECT proveedor_id, moneda INTO v_prov, v_moneda
        FROM proveedor_cc_movimientos WHERE id = v_chq.cc_movimiento_id AND tenant_id = v_tenant;
    ELSE
      SELECT proveedor_id, COALESCE(moneda, 'ARS') INTO v_prov, v_moneda
        FROM ordenes_compra WHERE id = v_chq.oc_id AND tenant_id = v_tenant;
    END IF;
    IF v_prov IS NULL THEN RAISE EXCEPTION 'No se encontró el pago que generó este cheque.'; END IF;

    -- La deuda vuelve a la CC del proveedor, en la moneda del pago.
    INSERT INTO proveedor_cc_movimientos(id, tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, descripcion, created_by)
    VALUES (v_ajuste, v_tenant, v_prov, v_chq.oc_id, 'ajuste', v_resto, v_moneda, CURRENT_DATE,
            'Cheque ' || v_que || COALESCE(' ' || v_chq.nro_cheque, ''), v_user);

    -- Cada OC que el pago había cubierto vuelve a deber (la más nueva primero). Cheques viejos: su OC.
    FOR v_oc IN
      SELECT o.id, x.imputado
        FROM (
          SELECT i.oc_id, SUM(i.monto) AS imputado
            FROM proveedor_pago_imputaciones i
           WHERE v_chq.cc_movimiento_id IS NOT NULL AND i.movimiento_id = v_chq.cc_movimiento_id
           GROUP BY i.oc_id
          UNION ALL
          SELECT v_chq.oc_id, v_resto WHERE v_chq.cc_movimiento_id IS NULL
        ) x
        JOIN ordenes_compra o ON o.id = x.oc_id AND o.tenant_id = v_tenant
       ORDER BY o.created_at DESC, o.numero DESC, o.id DESC
       FOR UPDATE OF o
    LOOP
      EXIT WHEN v_resto <= 0;
      SELECT LEAST(v_resto, v_oc.imputado, COALESCE(monto_pagado, 0)) INTO v_aplica FROM ordenes_compra WHERE id = v_oc.id;
      v_aplica := round(v_aplica, 2);
      CONTINUE WHEN v_aplica <= 0;
      UPDATE ordenes_compra SET
        monto_pagado = monto_pagado - v_aplica,
        estado_pago = CASE
          WHEN monto_pagado - v_aplica + COALESCE(monto_descuento, 0) >= COALESCE(monto_total, public.fn_oc_total(id)) - v_eps THEN 'pagada'
          WHEN fecha_vencimiento_pago IS NOT NULL THEN 'cuenta_corriente'   -- había quedado a plazo: sigue siéndolo
          WHEN monto_pagado - v_aplica > v_eps THEN 'pago_parcial'
          ELSE 'pendiente_pago' END
      WHERE id = v_oc.id;
      INSERT INTO proveedor_pago_imputaciones(tenant_id, movimiento_id, oc_id, monto) VALUES (v_tenant, v_ajuste, v_oc.id, -v_aplica);
      v_ocs := v_ocs || jsonb_build_object('oc_id', v_oc.id, 'etiqueta', public.fn_oc_etiqueta(v_oc.id), 'monto', v_aplica);
      v_detalle := v_detalle || CASE WHEN v_detalle = '' THEN '' ELSE ', ' END || public.fn_oc_etiqueta(v_oc.id);
      v_resto := v_resto - v_aplica;
    END LOOP;
    IF v_detalle <> '' THEN
      UPDATE proveedor_cc_movimientos SET descripcion = descripcion || ' — vuelve a deber ' || v_detalle WHERE id = v_ajuste;
    END IF;
  ELSIF v_chq.gasto_id IS NOT NULL THEN
    -- Gasto suelto pagado con cheque: vuelve a deber lo que pagó el cheque.
    SELECT id, descripcion, monto_pagado INTO v_g FROM gastos WHERE id = v_chq.gasto_id AND tenant_id = v_tenant FOR UPDATE;
    IF v_g.id IS NOT NULL THEN
      v_aplica := LEAST(v_resto, COALESCE(v_g.monto_pagado, 0));
      UPDATE gastos SET monto_pagado = monto_pagado - v_aplica,
        estado_pago = CASE WHEN monto_pagado - v_aplica > v_eps THEN 'parcial' ELSE 'pendiente' END
      WHERE id = v_g.id;
      v_gasto := jsonb_build_object('gasto_id', v_g.id, 'descripcion', v_g.descripcion, 'monto', v_aplica);
    END IF;
  END IF;

  -- mig 479: la plata nunca salió del banco → el egreso de la cuenta (Caja Fuerte) se compensa con un ingreso de HOY.
  -- No se borra el movimiento original (es historia). Va a la sesión original si sigue abierta; si no, a la Caja Fuerte
  -- de esa moneda (sesión permanente, como la usa la pantalla de Caja Fuerte).
  IF v_chq.caja_movimiento_id IS NOT NULL THEN
    SELECT * INTO v_cm FROM caja_movimientos WHERE id = v_chq.caja_movimiento_id AND tenant_id = v_tenant;
    IF v_cm.id IS NOT NULL AND v_cm.cuenta_origen_id IS NOT NULL THEN
      SELECT id INTO v_ses FROM caja_sesiones WHERE id = v_cm.sesion_id AND estado = 'abierta' AND cerrada_at IS NULL;
      IF v_ses IS NULL THEN
        SELECT cs.id INTO v_ses FROM caja_sesiones cs JOIN cajas c ON c.id = cs.caja_id
         WHERE c.tenant_id = v_tenant AND c.es_caja_fuerte AND COALESCE(c.moneda, 'ARS') = v_cm.moneda
           AND cs.estado = 'abierta'   -- cualquier sesión abierta: la caja admite una sola (fn_guard_una_sesion_abierta)
         ORDER BY COALESCE(cs.es_permanente, false) DESC, cs.created_at DESC LIMIT 1;
      END IF;
      IF v_ses IS NULL THEN
        SELECT id INTO v_fuerte FROM cajas WHERE tenant_id = v_tenant AND es_caja_fuerte AND COALESCE(moneda, 'ARS') = v_cm.moneda
         ORDER BY created_at LIMIT 1;
        IF v_fuerte IS NULL THEN
          RAISE EXCEPTION 'No se puede devolver el cheque a su cuenta: no hay Caja Fuerte en % (Caja → Caja Fuerte).', v_cm.moneda
            USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO caja_sesiones(tenant_id, caja_id, estado, es_permanente, moneda, usuario_id, monto_apertura)
        VALUES (v_tenant, v_fuerte, 'abierta', true, v_cm.moneda, v_user, 0)
        RETURNING id INTO v_ses;
      END IF;
      INSERT INTO caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda)
      VALUES (v_tenant, v_ses, 'ingreso_informativo', v_cm.monto,
              '[Cheque] Cheque ' || v_que || COALESCE(' N° ' || v_chq.nro_cheque, '') || ' — vuelve a la cuenta',
              v_cm.cuenta_origen_id, v_user, v_cm.moneda);
      v_caja := jsonb_build_object('cuenta_origen_id', v_cm.cuenta_origen_id, 'monto', v_cm.monto, 'moneda', v_cm.moneda);
    END IF;
  END IF;

  PERFORM set_config('app.rechazo_cheque', p_cheque_id::text, true);
  UPDATE cheques SET estado = v_que, updated_at = now() WHERE id = p_cheque_id;
  PERFORM set_config('app.rechazo_cheque', '', true);

  RETURN jsonb_build_object('ok', true, 'estado', v_que, 'ocs', v_ocs, 'gasto', v_gasto, 'caja', v_caja,
                            -- Cheque que NO generaron los pagos de la base (anterior a la mig 477, o de un gasto suelto): si
                            -- su pago restó de una cuenta, no se sabe cuál → la pantalla avisa revisarla a mano. Los de
                            -- las RPCs sin movimiento de caja no restaron de ninguna cuenta: nada que revisar.
                            'caja_sin_vinculo', v_chq.caja_movimiento_id IS NULL AND v_chq.cc_movimiento_id IS NULL,
                            'ajuste_cc', CASE WHEN v_prov IS NULL THEN NULL ELSE v_ajuste END);
END;
$function$;
REVOKE ALL ON FUNCTION public.revertir_cheque_propio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_cheque_propio(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rechazar_cheque_propio(p_cheque_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.revertir_cheque_propio(p_cheque_id, 'rechazado');
$function$;
REVOKE ALL ON FUNCTION public.rechazar_cheque_propio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rechazar_cheque_propio(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_cheques_rechazo_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND OLD.tipo = 'propio' THEN
    -- Un cheque propio rechazado o anulado no cambia de estado (si estaba entregado, su pago ya se revirtió).
    IF OLD.estado IN ('rechazado', 'anulado') THEN
      RAISE EXCEPTION 'Un cheque propio % no cambia de estado.', OLD.estado USING ERRCODE = 'check_violation';
    END IF;
    -- Entregado → rechazado/anulado revierte el pago: solo por revertir_cheque_propio (mig 479: también anulado).
    IF OLD.estado = 'entregado' AND NEW.estado IN ('rechazado', 'anulado')
       AND COALESCE(current_setting('app.rechazo_cheque', true), '') <> OLD.id::text THEN
      RAISE EXCEPTION 'Para % un cheque propio entregado usá Cheques (revierte el pago).',
        CASE NEW.estado WHEN 'anulado' THEN 'anular' ELSE 'rechazar' END USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_oc_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  -- mig 479 (decisión de GO 2026-10-08): el cierre protege el CONTENIDO de la OC (ítems, precios, proveedor, fecha), no su
  -- estado de pago. Pagar, descontar o revertir un pago (cheque rechazado/anulado) son hechos del día en que ocurren.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['monto_pagado', 'estado_pago', 'monto_descuento', 'monto_total',
        'fecha_vencimiento_pago', 'dias_plazo_pago', 'condiciones_pago', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['monto_pagado', 'estado_pago', 'monto_descuento', 'monto_total',
        'fecha_vencimiento_pago', 'dias_plazo_pago', 'condiciones_pago', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar órdenes de compra anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_gastos_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  -- mig 479 (decisión de GO 2026-10-08): pagar un gasto viejo o revertir su pago (cheque rechazado/anulado) es un hecho de
  -- hoy; el cierre protege el gasto en sí (fecha, monto, categoría, IVA…), no su estado de pago.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['monto_pagado', 'estado_pago'])
                        = (to_jsonb(OLD) - ARRAY['monto_pagado', 'estado_pago']) THEN
    RETURN NEW;
  END IF;
  IF v_cierre IS NOT NULL AND OLD.fecha <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — usá una nota de corrección en lugar de editar/eliminar gastos viejos.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.fecha IS NOT NULL THEN
    IF v_cierre IS NOT NULL AND NEW.fecha <= v_cierre THEN
      RAISE EXCEPTION 'No podés asignar a este gasto una fecha dentro de un periodo cerrado (% o anterior).', v_cierre USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$;
