-- Migration 379: Fase 1 (cimientos de datos) del plan "Compras/Gastos en USD + tasa de cambio
-- editable" (relevamiento nuevo, respondido por Fede 2026-08-21 — ver
-- G360.Wiki/wiki/development/reglas-negocio.md). Distinto del G5 (Caja USD, que cubrió VENTAS):
-- este cubre el lado de COMPRAS/GASTOS, feature nueva de punta a punta (gastos/gastos_fijos/
-- ordenes_compra no tenían ninguna columna de moneda hasta esta migración).
--
-- Esta migración es SOLO cimiento de datos: agrega columnas + preserva el comportamiento actual
-- al 100% (default 'ARS' en todo lo existente). NO cablea todavía ninguna pantalla — eso son las
-- fases siguientes del plan. Aditiva, sin DDL destructivo.

-- 1) Moneda + cotización snapshot en Gastos (variable y fijo) y Compras/OC. Mismo patrón que
--    ventas.cotizacion_usd (mig 368): NULL salvo que la transacción haya tenido una conversión
--    real (C1 del relevamiento — "si hay descalce de moneda, ahí sí se guarda la cotización usada
--    para esa conversión puntual"; si costo y pago coinciden en moneda, queda NULL sin
--    conversión). Nunca se redondea (H1) — numeric(14,2) preserva los decimales exactos que ya usa
--    ventas.cotizacion_usd.
ALTER TABLE public.gastos        ADD COLUMN IF NOT EXISTS moneda         text NOT NULL DEFAULT 'ARS';
ALTER TABLE public.gastos        ADD COLUMN IF NOT EXISTS cotizacion_usd numeric(14,2);
ALTER TABLE public.gastos_fijos  ADD COLUMN IF NOT EXISTS moneda         text NOT NULL DEFAULT 'ARS';
ALTER TABLE public.gastos_fijos  ADD COLUMN IF NOT EXISTS cotizacion_usd numeric(14,2);
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS moneda         text NOT NULL DEFAULT 'ARS';
ALTER TABLE public.ordenes_compra ADD COLUMN IF NOT EXISTS cotizacion_usd numeric(14,2);

COMMENT ON COLUMN public.gastos.moneda IS 'Moneda nativa del gasto (ARS/USD) — Compras/Gastos USD, mig 379.';
COMMENT ON COLUMN public.gastos.cotizacion_usd IS 'Cotización usada SOLO si hubo descalce (costo≠moneda de pago) — snapshot congelado al confirmar, uso interno, nunca va a AFIP (mig 379).';
COMMENT ON COLUMN public.gastos_fijos.moneda IS 'Moneda nativa del gasto fijo (ARS/USD) — Compras/Gastos USD, mig 379.';
COMMENT ON COLUMN public.gastos_fijos.cotizacion_usd IS 'Cotización usada SOLO si hubo descalce — uso interno, mig 379.';
COMMENT ON COLUMN public.ordenes_compra.moneda IS 'Moneda nativa de la OC (ARS/USD) — Compras/Gastos USD, mig 379.';
COMMENT ON COLUMN public.ordenes_compra.cotizacion_usd IS 'Cotización usada SOLO si hubo descalce — snapshot congelado al confirmar el pago, uso interno, mig 379.';

-- 2) 🔴 Fix real encontrado al diseñar esta fase (REGLA #0): registrar_pago_oc() ya inserta
--    egresos reales en caja_movimientos (tipo='egreso'/'egreso_informativo') para la sesión de
--    caja que se le pase — la Caja USD YA soporta egresos, no hay que construir esa capacidad de
--    cero (respuesta a la pregunta técnica de Fede en D1). Pero el INSERT nunca completaba la
--    columna moneda (caja_movimientos.moneda, mig 368) — quedaba en el DEFAULT 'ARS' siempre, sin
--    importar la moneda real del método de pago usado. Si se pagara una OC en USD desde una Caja
--    USD, el movimiento habría quedado mal etiquetado como ARS (violación latente de integridad
--    contable). Fix: se agrega v_moneda_medio (misma fuente que v_es_efectivo, metodos_pago.moneda
--    por nombre de medio) y se completa moneda en el INSERT. CERO cambio de comportamiento para
--    pagos en ARS (moneda ya era 'ARS' en la práctica, ahora queda explícito en vez de por default).
CREATE OR REPLACE FUNCTION public.registrar_pago_oc(p_oc_id uuid, p_medios jsonb, p_descuento_monto numeric DEFAULT 0, p_clave text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_cheque jsonb DEFAULT NULL::jsonb, p_pago_dias integer DEFAULT 30, p_pago_condiciones text DEFAULT NULL::text)
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

  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE orden_compra_id = p_oc_id;
  END IF;

  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montonocc
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
  SELECT COALESCE(SUM((e->>'monto')::numeric),0) INTO v_montocheque
    FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' = 'Cheque';
  v_montototal := v_montocc + v_montonocc;
  IF v_montototal <= v_eps THEN RAISE EXCEPTION 'Ingresá al menos un monto válido'; END IF;

  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

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

  IF v_montonocc > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('tipo', e->>'tipo', 'monto', (e->>'monto')::numeric))
      INTO v_medios_nocc FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente';
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, medio_pago, descripcion, caja_sesion_id, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'pago', -v_montonocc, CURRENT_DATE, v_medios_nocc::text,
            'Pago OC #'||v_oc.numero, p_caja_sesion_id, v_user);
  END IF;
  IF v_montocc > 0 THEN
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, fecha, fecha_vencimiento, descripcion, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'oc', v_montocc, CURRENT_DATE, v_fecha_venc,
            'CC OC #'||v_oc.numero||' — '||v_dias||'d', v_user);
  END IF;

  IF v_montocheque > 0 AND p_cheque IS NOT NULL THEN
    INSERT INTO public.cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, oc_id, sucursal_id, notas, created_by)
    VALUES (v_tenant, 'propio', 'entregado', v_montocheque,
            NULLIF(p_cheque->>'nro',''), NULLIF(p_cheque->>'banco',''), CURRENT_DATE,
            NULLIF(p_cheque->>'fecha_cobro','')::date, v_oc.proveedor_id, p_oc_id,
            NULLIF(p_cheque->>'sucursal_id','')::uuid, 'Generado por pago OC #'||v_oc.numero, v_user);
  END IF;

  IF p_caja_sesion_id IS NOT NULL THEN
    v_concepto := 'Pago OC #'||v_oc.numero||' — '||COALESCE(v_prov_nombre,'');
    FOR v_medio IN SELECT e FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente'
    LOOP
      -- Fase 1 Caja USD (mig 368, A3): 'Efectivo' hardcodeado → lista es_efectivo por tenant.
      SELECT es_efectivo, moneda INTO v_es_efectivo, v_moneda_medio
        FROM public.metodos_pago WHERE tenant_id = v_tenant AND nombre = v_medio->>'tipo';
      v_es_efectivo := COALESCE(v_es_efectivo, false);
      -- Fase 1 Compras/Gastos USD (mig 379): completar moneda real del medio usado — antes
      -- quedaba siempre en el DEFAULT 'ARS' de caja_movimientos sin importar el medio.
      v_moneda_medio := COALESCE(v_moneda_medio, 'ARS');
      INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda)
      VALUES (v_tenant, p_caja_sesion_id,
              CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
              (v_medio->>'monto')::numeric,
              CASE WHEN v_es_efectivo THEN v_concepto ELSE '['||(v_medio->>'tipo')||'] '||v_concepto END,
              CASE WHEN v_es_efectivo THEN NULL ELSE NULLIF(v_medio->>'cuenta_origen_id','')::uuid END,
              v_user, v_moneda_medio);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$
;
