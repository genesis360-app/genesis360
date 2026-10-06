-- 475 — Envío de la OC: ¿lo cobra el proveedor o un tercero? (decisión de GO 2026-10-06; consulta al contador C-22)
--
-- Antes: Proveedores sumaba el envío al total de la OC, pero el pago, la deuda y el gasto de la recepción no.
-- Ahora la OC dice quién cobra el envío:
--   • 'proveedor' (default): va en SU factura → suma al total a pagarle y a la deuda. Al recibir se carga en su CC
--     (`es_envio`, UNO por OC) a partir del gasto "Envío OC …" que crea la recepción (`gastos.oc_envio_id`).
--   • 'tercero': lo factura el transportista → no suma a lo del proveedor; la recepción crea el gasto del envío igual
--     (para que el costo exista), pero no carga nada en la CC del proveedor.
-- Una OC con un total ya guardado (se pagó algo) mantiene ese total: no se reescribe lo histórico. En PROD no hay OCs
-- con envío (verificado 06/10). Las funciones son la definición VIGENTE (leída de la base, migs 473/474) + el envío.

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS envio_a_cargo text NOT NULL DEFAULT 'proveedor',
  ADD COLUMN IF NOT EXISTS envio_transportista text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_compra_envio_a_cargo_check') THEN
    ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_envio_a_cargo_check
      CHECK (envio_a_cargo IN ('proveedor', 'tercero'));
  END IF;
END $$;

ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS oc_envio_id uuid REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gastos_un_envio_por_oc ON public.gastos (oc_envio_id) WHERE oc_envio_id IS NOT NULL;

ALTER TABLE public.proveedor_cc_movimientos ADD COLUMN IF NOT EXISTS es_envio boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS public.proveedor_cc_mov_cargo_por_recepcion;
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_cc_mov_cargo_por_recepcion
  ON public.proveedor_cc_movimientos (recepcion_id) WHERE tipo = 'oc' AND recepcion_id IS NOT NULL AND NOT es_envio;
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_cc_mov_un_envio_por_oc
  ON public.proveedor_cc_movimientos (oc_id) WHERE es_envio;

CREATE OR REPLACE FUNCTION public.fn_oc_total(p_oc_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(o.monto_total,
    (SELECT COALESCE(SUM(COALESCE(i.cantidad, 0) * COALESCE(i.precio_unitario, 0)), 0)
       FROM orden_compra_items i WHERE i.orden_compra_id = o.id)
    + (CASE WHEN o.tiene_envio AND o.envio_a_cargo = 'proveedor' THEN GREATEST(COALESCE(o.costo_envio, 0), 0) ELSE 0 END))   -- mig 475: + envío si lo cobra el proveedor
  FROM ordenes_compra o WHERE o.id = p_oc_id AND o.tenant_id = public.get_user_tenant_id();
$function$;

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
    INSERT INTO public.cheques(tenant_id, tipo, estado, monto, nro_cheque, banco, fecha_emision, fecha_cobro, proveedor_id, oc_id, sucursal_id, notas, created_by)
    VALUES (v_tenant, 'propio', 'entregado', v_montocheque,
            NULLIF(p_cheque->>'nro',''), NULLIF(p_cheque->>'banco',''), CURRENT_DATE,
            NULLIF(p_cheque->>'fecha_cobro','')::date, v_oc.proveedor_id, p_oc_id,
            NULLIF(p_cheque->>'sucursal_id','')::uuid, 'Generado por pago '||public.fn_oc_etiqueta(v_oc.id), v_user);
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
              CASE WHEN v_medio->>'moneda' = v_moneda_oc THEN NULL ELSE p_cotizacion_usd END);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_pago', v_nuevo_estado, 'monto_pagado', v_nuevo_pagado, 'monto_cheque', v_montocheque);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_cc_proveedor_cargo_recepcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
BEGIN
  IF NEW.monto IS NULL OR NEW.monto <= 0 THEN RETURN NEW; END IF;
  -- mig 475: gasto del ENVÍO de una OC. Si lo cobra el proveedor, se carga en su CC (uno por OC); si es de un tercero,
  -- el gasto existe pero el proveedor no tiene nada que ver.
  IF NEW.oc_envio_id IS NOT NULL THEN
    INSERT INTO proveedor_cc_movimientos (tenant_id, proveedor_id, oc_id, recepcion_id, tipo, monto, moneda, fecha, descripcion, created_by, es_envio)
    SELECT NEW.tenant_id, o.proveedor_id, o.id, NEW.recepcion_id, 'oc', NEW.monto, upper(COALESCE(NEW.moneda, 'ARS')), NEW.fecha,
           'Envío ' || public.fn_oc_etiqueta(o.id), NEW.usuario_id, true
      FROM ordenes_compra o
     WHERE o.id = NEW.oc_envio_id AND o.tenant_id = NEW.tenant_id AND o.envio_a_cargo = 'proveedor'
    ON CONFLICT (oc_id) WHERE es_envio DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.recepcion_id IS NULL THEN RETURN NEW; END IF;
  SELECT r.id, r.numero, r.oc_id, o.proveedor_id, o.numero AS oc_numero INTO v_rec
    FROM recepciones r JOIN ordenes_compra o ON o.id = r.oc_id AND o.tenant_id = r.tenant_id
   WHERE r.id = NEW.recepcion_id AND r.tenant_id = NEW.tenant_id;
  IF v_rec.id IS NULL THEN RETURN NEW; END IF;   -- recepción sin OC: no hay proveedor con OC que cargar
  INSERT INTO proveedor_cc_movimientos (tenant_id, proveedor_id, oc_id, recepcion_id, tipo, monto, moneda, fecha, descripcion, created_by)
  VALUES (NEW.tenant_id, v_rec.proveedor_id, v_rec.oc_id, v_rec.id, 'oc', NEW.monto, upper(COALESCE(NEW.moneda, 'ARS')), NEW.fecha,
          'Compra ' || public.fn_oc_etiqueta(v_rec.oc_id) || ' — recepción #' || v_rec.numero, NEW.usuario_id)
  ON CONFLICT (recepcion_id) WHERE tipo = 'oc' AND recepcion_id IS NOT NULL AND NOT es_envio DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_oc_guard_con_pagos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_oc uuid; v_num int; v_pagado numeric;
BEGIN
  IF TG_TABLE_NAME = 'ordenes_compra' THEN
    IF NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id AND (
         OLD.monto_pagado > 0 OR EXISTS (SELECT 1 FROM proveedor_cc_movimientos WHERE oc_id = OLD.id)) THEN
      RAISE EXCEPTION 'La % ya tiene pagos o recepciones: no se puede cambiar el proveedor.', public.fn_oc_etiqueta(OLD.id)
        USING ERRCODE = 'check_violation';
    END IF;
    -- mig 475: el envío cambia lo que se le debe al proveedor → no se toca si la OC ya tiene pagos o el envío ya se cargó.
    IF (NEW.costo_envio IS DISTINCT FROM OLD.costo_envio OR NEW.tiene_envio IS DISTINCT FROM OLD.tiene_envio
        OR NEW.envio_a_cargo IS DISTINCT FROM OLD.envio_a_cargo) AND (
         OLD.monto_pagado > 0 OR EXISTS (SELECT 1 FROM gastos WHERE oc_envio_id = OLD.id)) THEN
      RAISE EXCEPTION 'La % ya tiene pagos o el envío ya se registró: no se puede cambiar el envío.', public.fn_oc_etiqueta(OLD.id)
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN v_oc := OLD.orden_compra_id; ELSE v_oc := NEW.orden_compra_id; END IF;
  SELECT numero, monto_pagado INTO v_num, v_pagado FROM ordenes_compra WHERE id = v_oc;
  IF COALESCE(v_pagado, 0) > 0 OR EXISTS (SELECT 1 FROM proveedor_pago_imputaciones WHERE oc_id = v_oc) THEN
    RAISE EXCEPTION 'La % ya tiene pagos: no se pueden cambiar sus ítems. Si cambió el pedido, hacé una OC nueva.', public.fn_oc_etiqueta(v_oc)
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oc_guard_con_pagos ON public.ordenes_compra;
CREATE TRIGGER trg_oc_guard_con_pagos BEFORE UPDATE OF proveedor_id, costo_envio, tiene_envio, envio_a_cargo ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_guard_con_pagos();
