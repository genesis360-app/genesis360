-- Migration 381: Fase 3 (pago con descalce de moneda) del plan "Compras/Gastos en USD + tasa de
-- cambio editable" (relevamiento respondido por Fede 2026-08-21, secciones B3/C1). Continúa las
-- Fases 1 (mig 379) y 2 (mig 380).
--
-- 🔴 Corrección de diseño encontrada ANTES de cablear el frontend (mejor ahora que con datos reales
-- encima — REGLA #0): la mig 379 puso `cotizacion_usd` como UNA columna en `ordenes_compra`/`gastos`/
-- `gastos_fijos`. Pero una OC/gasto se puede pagar en VARIAS cuotas a lo largo del tiempo (ya existe
-- `monto_pagado`/`estado_pago='pago_parcial'`) — si hay más de un pago con descalce, una sola columna
-- no puede guardar más de una cotización sin pisar la anterior, violando C1 ("cada conversión puntual
-- guarda su propia cotización"). Verificado antes de tocar nada: 0 filas usan esas 3 columnas hoy
-- (ninguna OC/gasto en USD existe todavía en ningún tenant — la Fase 1 se aplicó hoy mismo, sin
-- wiring de frontend hasta ahora), así que no hay dato real que perder al corregirlo.
--
-- Diseño correcto: mover `cotizacion_usd` a `caja_movimientos` — una fila por MOVIMIENTO real de
-- pago, exactamente el mismo patrón que ya usa `ventas.cotizacion_usd` (mig 368, G5) para el lado de
-- ventas. `gastos.moneda`/`ordenes_compra.moneda` (la moneda NATIVA del gasto/OC, fija) quedan sin
-- cambios — eso sí es correcto a nivel de cabecera, no cambia entre pagos.
ALTER TABLE public.ordenes_compra DROP COLUMN IF EXISTS cotizacion_usd;
ALTER TABLE public.gastos         DROP COLUMN IF EXISTS cotizacion_usd;
ALTER TABLE public.gastos_fijos   DROP COLUMN IF EXISTS cotizacion_usd;

ALTER TABLE public.caja_movimientos ADD COLUMN IF NOT EXISTS cotizacion_usd numeric(14,2);
COMMENT ON COLUMN public.caja_movimientos.cotizacion_usd IS
  'Cotización manual usada SOLO si este movimiento fue un pago con descalce de moneda (medio en moneda distinta a la del gasto/OC que paga, B3/C1 del relevamiento Compras/Gastos USD, mig 381) — snapshot congelado al confirmar, nunca se recalcula. NULL = sin conversión (medio y OC/gasto en la misma moneda). Mismo criterio que ventas.cotizacion_usd (mig 368).';

-- registrar_pago_oc(): agrega p_cotizacion_usd (nullable, al final — compatible con cualquier
-- llamador existente que no lo pase). Si algún medio no-CC está en una moneda distinta a la de la OC
-- (descalce), exige p_cotizacion_usd y convierte SERVER-SIDE (nunca confiar en la aritmética del
-- cliente para esto): 1 USD = p_cotizacion_usd ARS. El monto ORIGINAL (en la moneda real del medio)
-- es lo que sale físicamente de esa caja — el equivalente convertido es lo que efectivamente cubre
-- de la deuda de la OC (monto_pagado/saldo, siempre en la moneda nativa de la OC). Sin redondeo (H1).
-- Cuenta Corriente queda excluida de la conversión (moneda-agnóstica por diseño — es un saldo a
-- favor/en contra, no un movimiento físico de una caja concreta).
--
-- 🔴 Cambiar la CANTIDAD de parámetros de una función existente NO es reemplazable con un simple
-- CREATE OR REPLACE — Postgres identifica una función por (nombre, tipos de argumentos), así que
-- sin el DROP explícito esto crearía un OVERLOAD nuevo dejando viva la función vieja (de 8 args, sin
-- la conversión) — el único caller real (GastosPage.tsx) sigue llamando con 8 args nombrados, así
-- que Postgres resolvería siempre hacia la vieja y toda esta migración quedaría código muerto.
-- Mismo patrón ya usado en este repo para este mismo problema: mig 190
-- (update_envio_by_token), mig 248 (re-grants tras crear funciones nuevas).
DROP FUNCTION IF EXISTS public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text);

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
  v_moneda_oc := COALESCE(v_oc.moneda, 'ARS');

  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE orden_compra_id = p_oc_id;
  END IF;

  -- Enriquecer cada medio no-CC con su equivalente en la moneda de la OC (monto_oc). Si coincide con
  -- la moneda de la OC, monto_oc = monto tal cual. Si no (descalce), exige p_cotizacion_usd y convierte.
  FOR v_medio IN SELECT e FROM jsonb_array_elements(p_medios) e WHERE e->>'tipo' <> 'Cuenta Corriente'
  LOOP
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
  SELECT COALESCE(SUM((e->>'monto_oc')::numeric),0) INTO v_montonocc
    FROM jsonb_array_elements(v_medios_enriquecidos) e;
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
    FOR v_medio IN SELECT e FROM jsonb_array_elements(v_medios_enriquecidos) e
    LOOP
      -- Fase 1 Caja USD (mig 368, A3): 'Efectivo' hardcodeado → lista es_efectivo por tenant.
      SELECT es_efectivo INTO v_es_efectivo FROM public.metodos_pago WHERE tenant_id = v_tenant AND nombre = v_medio->>'tipo';
      v_es_efectivo := COALESCE(v_es_efectivo, false);
      INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda, cotizacion_usd)
      VALUES (v_tenant, p_caja_sesion_id,
              CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
              (v_medio->>'monto')::numeric,
              CASE WHEN v_es_efectivo THEN v_concepto ELSE '['||(v_medio->>'tipo')||'] '||v_concepto END,
              CASE WHEN v_es_efectivo THEN NULL ELSE NULLIF(v_medio->>'cuenta_origen_id','')::uuid END,
              v_user, v_medio->>'moneda',
              CASE WHEN v_medio->>'moneda' = v_moneda_oc THEN NULL ELSE p_cotizacion_usd END);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$
;

-- 🔴 Al ser una función NUEVA (firma distinta a la que reemplaza), NO hereda los GRANT/REVOKE que la
-- mig 248 le había puesto específicamente a la versión de 8 args — Postgres otorga EXECUTE a PUBLIC
-- por default en todo CREATE FUNCTION nuevo (esto es aparte del hallazgo de la mig 248 sobre anon).
-- Verificado con has_function_privilege('anon', oid, 'EXECUTE') tras aplicar solo el REVOKE FROM
-- anon: seguía dando TRUE, porque anon hereda vía el grant de PUBLIC — un REVOKE FROM un rol
-- puntual NO anula lo que ya tiene por PUBLIC. Hay que revocar de PUBLIC explícitamente además de
-- anon, y volver a verificar con has_function_privilege (no confiar en el nombre del grantee en
-- information_schema.routine_privileges — hay que probar el permiso real).
REVOKE EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text, numeric) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text, numeric) TO authenticated, service_role;
