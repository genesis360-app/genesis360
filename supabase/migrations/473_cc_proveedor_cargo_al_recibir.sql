-- 473 — Cuenta corriente de proveedores: la deuda nace al RECIBIR (decisión de GO 2026-10-06) — 🛑 REGLA #0
--
-- Bugs que cierra (reportados por GO 06/10, DEV; en PROD no había ni un movimiento):
--   a) Una OC se podía "pasar a CC" más de una vez: registrar_pago_oc cargaba la deuda en la CC al elegir el medio
--      "Cuenta Corriente" y el saldo de la OC no lo descontaba → OC #84 quedó con 2 × $8.100.
--   b) El saldo de la CC daba negativo: un pago al contado entraba como `pago` sin un cargo que lo compense.
--   c) Pagar desde la CC del proveedor no imputaba a ninguna OC: quedaban pendientes para siempre (pago doble).
--   d) fn_saldo_proveedor_cc (SECURITY DEFINER) no filtraba por negocio.
--
-- Modelo nuevo (criterio de lo devengado: la deuda existe cuando se recibe el bien; una OC es solo un compromiso):
--   • CARGO (`tipo='oc'`, +monto): al confirmar una recepción de una OC, por lo recibido valorizado. Lo pone un trigger
--     sobre el gasto "Compra OC #N" que crea la recepción (es el devengado que ya existía). Uno por recepción.
--   • PAGO (`tipo='pago'`, −monto): todo pago (anticipo, contado o pago de la deuda) descuenta. Se imputa a OCs
--     (`proveedor_pago_imputaciones`): desde Gastos, a esa OC; desde la CC del proveedor, a la OC más VIEJA primero
--     (pedido de GO) — y así se van cerrando.
--   • "Cuenta Corriente" deja de ser un medio de pago que carga deuda: solo fija el plazo/vencimiento de lo que falta.
--   • Saldo < 0 = anticipo a favor del negocio (se pagó antes de recibir).
--   • Invariante en la base: una OC nunca tiene pagado + descuento > total (CHECK).
--
--   • Cada movimiento lleva su MONEDA (la de la OC): un saldo en USD no se suma a uno en pesos.
--   • Un descuento que se le saca a una OC también baja la deuda (contra-asiento `ajuste`).
--   • El total de una OC que nunca se pagó no está guardado (`monto_total` NULL): se usa la suma de sus ítems
--     (`fn_oc_total`). Una OC con pagos no cambia de proveedor ni de ítems (trigger), así el total no se corre.
--   • El cargo es por lo RECIBIDO al precio de la recepción; puede diferir del total de la OC. El pago desde la CC
--     llega hasta lo pendiente de las OCs o la deuda, lo que sea mayor; lo que no tenga OC queda como pago a cuenta.
--
-- Datos viejos: los cargos que ponía "pasar a CC" se ANULAN con un `ajuste` compensatorio (no se borran: rastro
-- contable) y se cargan las recepciones ya confirmadas. Idempotente. En PROD no hay filas (verificado 06/10).

-- ── 1. Columnas, imputaciones, invariante ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.proveedor_cc_movimientos
  ADD COLUMN IF NOT EXISTS recepcion_id uuid REFERENCES public.recepciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'ARS';
-- Moneda de lo ya registrado = la de su OC (sin OC queda ARS, el default de siempre).
UPDATE public.proveedor_cc_movimientos m SET moneda = COALESCE(o.moneda, 'ARS')
  FROM public.ordenes_compra o WHERE o.id = m.oc_id AND m.moneda IS DISTINCT FROM COALESCE(o.moneda, 'ARS');
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_cc_mov_cargo_por_recepcion
  ON public.proveedor_cc_movimientos (recepcion_id) WHERE tipo = 'oc' AND recepcion_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.proveedor_pago_imputaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  movimiento_id uuid NOT NULL REFERENCES public.proveedor_cc_movimientos(id) ON DELETE CASCADE,
  oc_id         uuid NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE RESTRICT,   -- una OC pagada no se borra
  monto         numeric(12,2) NOT NULL CHECK (monto > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proveedor_pago_imputaciones_mov ON public.proveedor_pago_imputaciones (movimiento_id);
CREATE INDEX IF NOT EXISTS proveedor_pago_imputaciones_oc  ON public.proveedor_pago_imputaciones (oc_id);
CREATE INDEX IF NOT EXISTS proveedor_pago_imputaciones_tenant ON public.proveedor_pago_imputaciones (tenant_id);
ALTER TABLE public.proveedor_pago_imputaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'proveedor_pago_imputaciones' AND policyname = 'proveedor_pago_imputaciones_select') THEN
    CREATE POLICY proveedor_pago_imputaciones_select ON public.proveedor_pago_imputaciones
      FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
  END IF;
END $$;
-- Se escribe solo desde las funciones de pago (SECURITY DEFINER): sin policy de escritura.
REVOKE ALL ON public.proveedor_pago_imputaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.proveedor_pago_imputaciones FROM authenticated;
GRANT SELECT ON public.proveedor_pago_imputaciones TO authenticated;

-- Total efectivo de una OC: el guardado o, si nunca se pagó (NULL), la suma de sus ítems — mismo criterio que
-- registrar_pago_oc y que el front (calcMontoTotalOC).
CREATE OR REPLACE FUNCTION public.fn_oc_total(p_oc_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(o.monto_total,
    (SELECT COALESCE(SUM(COALESCE(i.cantidad, 0) * COALESCE(i.precio_unitario, 0)), 0)
       FROM orden_compra_items i WHERE i.orden_compra_id = o.id))
  FROM ordenes_compra o WHERE o.id = p_oc_id AND o.tenant_id = public.get_user_tenant_id();
$function$;
REVOKE ALL ON FUNCTION public.fn_oc_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oc_total(uuid) TO authenticated;

-- Una OC con plata registrada (pagos/imputaciones o cargos) no cambia de proveedor ni de ítems: si no, el total y la CC
-- quedan desfasados (la edición reemplaza los ítems y `monto_total` no se recalcula).
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
      RAISE EXCEPTION 'La OC #% ya tiene pagos o recepciones: no se puede cambiar el proveedor.', OLD.numero
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN v_oc := OLD.orden_compra_id; ELSE v_oc := NEW.orden_compra_id; END IF;
  SELECT numero, monto_pagado INTO v_num, v_pagado FROM ordenes_compra WHERE id = v_oc;
  IF COALESCE(v_pagado, 0) > 0 OR EXISTS (SELECT 1 FROM proveedor_pago_imputaciones WHERE oc_id = v_oc) THEN
    RAISE EXCEPTION 'La OC #% ya tiene pagos: no se pueden cambiar sus ítems. Si cambió el pedido, hacé una OC nueva.', v_num
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_oc_guard_con_pagos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_oc_guard_con_pagos ON public.ordenes_compra;
CREATE TRIGGER trg_oc_guard_con_pagos BEFORE UPDATE OF proveedor_id ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_guard_con_pagos();
DROP TRIGGER IF EXISTS trg_oc_items_guard_con_pagos ON public.orden_compra_items;
CREATE TRIGGER trg_oc_items_guard_con_pagos BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, orden_compra_id OR DELETE
  ON public.orden_compra_items FOR EACH ROW EXECUTE FUNCTION public.fn_oc_guard_con_pagos();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_compra_pagado_no_excede_total') THEN
    ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_pagado_no_excede_total CHECK (
      monto_pagado >= 0 AND monto_descuento >= 0
      AND (monto_total IS NULL OR monto_pagado + monto_descuento <= monto_total + 0.5));
  END IF;
END $$;

-- ── 2. Saldo con filtro de negocio ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_saldo_proveedor_cc(p_proveedor_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- En la moneda del NEGOCIO (lo usa el control de límite de CC, que está en esa moneda): no se mezclan monedas.
  SELECT COALESCE(SUM(m.monto), 0)
  FROM proveedor_cc_movimientos m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.proveedor_id = p_proveedor_id AND m.tenant_id = public.get_user_tenant_id()
    AND m.moneda = upper(COALESCE(t.moneda, 'ARS'));
$function$;
REVOKE ALL ON FUNCTION public.fn_saldo_proveedor_cc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_proveedor_cc(uuid) TO authenticated;

-- Resumen para el modal de la CC, POR MONEDA: saldo (deuda real; < 0 = anticipo) y lo pendiente de pagar en OCs.
CREATE OR REPLACE FUNCTION public.fn_proveedor_cc_resumen(p_proveedor_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'saldo', COALESCE((
      SELECT jsonb_object_agg(moneda, saldo) FROM (
        SELECT moneda, SUM(monto) AS saldo FROM proveedor_cc_movimientos
         WHERE proveedor_id = p_proveedor_id AND tenant_id = public.get_user_tenant_id()
         GROUP BY 1) s), '{}'::jsonb),
    'pendiente_ocs', COALESCE((
      SELECT jsonb_object_agg(moneda, pendiente) FROM (
        SELECT COALESCE(o.moneda, 'ARS') AS moneda,
               SUM(public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento) AS pendiente
        FROM ordenes_compra o
        WHERE o.proveedor_id = p_proveedor_id AND o.tenant_id = public.get_user_tenant_id()
          AND o.estado NOT IN ('borrador', 'cancelada') AND o.estado_pago <> 'pagada'
          AND public.fn_oc_total(o.id) - o.monto_pagado - o.monto_descuento > 0.5
        GROUP BY 1) x), '{}'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.fn_proveedor_cc_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proveedor_cc_resumen(uuid) TO authenticated;

-- ── 3. Cargo al recibir ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cc_proveedor_cargo_recepcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
BEGIN
  IF NEW.recepcion_id IS NULL OR NEW.monto IS NULL OR NEW.monto <= 0 THEN RETURN NEW; END IF;
  SELECT r.id, r.numero, r.oc_id, o.proveedor_id, o.numero AS oc_numero INTO v_rec
    FROM recepciones r JOIN ordenes_compra o ON o.id = r.oc_id AND o.tenant_id = r.tenant_id
   WHERE r.id = NEW.recepcion_id AND r.tenant_id = NEW.tenant_id;
  IF v_rec.id IS NULL THEN RETURN NEW; END IF;   -- recepción sin OC: no hay proveedor con OC que cargar
  INSERT INTO proveedor_cc_movimientos (tenant_id, proveedor_id, oc_id, recepcion_id, tipo, monto, moneda, fecha, descripcion, created_by)
  VALUES (NEW.tenant_id, v_rec.proveedor_id, v_rec.oc_id, v_rec.id, 'oc', NEW.monto, upper(COALESCE(NEW.moneda, 'ARS')), NEW.fecha,
          'Compra OC #' || v_rec.oc_numero || ' — recepción #' || v_rec.numero, NEW.usuario_id)
  ON CONFLICT (recepcion_id) WHERE tipo = 'oc' AND recepcion_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cc_proveedor_cargo_recepcion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cc_proveedor_cargo_recepcion ON public.gastos;
CREATE TRIGGER trg_cc_proveedor_cargo_recepcion AFTER INSERT ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cc_proveedor_cargo_recepcion();

-- ── 4. Pago de una OC (desde Gastos) ─────────────────────────────────────────────────────────────────────────────────
-- Definición vigente (mig 381, leída de la base) con: lock de la OC (doble click), "Cuenta Corriente" ya no carga
-- deuda (solo plazo), el pago se imputa a la OC, y el estado sale de lo pagado de verdad.
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
  IF v_oc.estado IN ('borrador', 'cancelada') THEN
    RAISE EXCEPTION 'La OC #% está %: no se le registran pagos.', v_oc.numero, v_oc.estado USING ERRCODE = 'check_violation';
  END IF;
  SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_oc.proveedor_id AND tenant_id = v_tenant;
  v_moneda_oc := COALESCE(v_oc.moneda, 'ARS');

  v_total := v_oc.monto_total;
  IF v_total IS NULL THEN
    SELECT COALESCE(SUM(COALESCE(cantidad,0) * COALESCE(precio_unitario,0)), 0)
      INTO v_total FROM public.orden_compra_items WHERE orden_compra_id = p_oc_id;
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
            'Pago OC #'||v_oc.numero, p_caja_sesion_id, v_user)
    RETURNING id INTO v_mov_id;
    INSERT INTO public.proveedor_pago_imputaciones(tenant_id, movimiento_id, oc_id, monto)
    VALUES (v_tenant, v_mov_id, p_oc_id, round(v_montonocc, 2));
  END IF;
  -- mig 473: el descuento que se le saca a la OC también baja la deuda con el proveedor (si no, la OC queda pagada y
  -- la CC con saldo para siempre).
  IF v_descuento > 0 THEN
    INSERT INTO public.proveedor_cc_movimientos(tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, descripcion, created_by)
    VALUES (v_tenant, v_oc.proveedor_id, p_oc_id, 'ajuste', -round(v_descuento, 2), v_moneda_oc, CURRENT_DATE,
            'Descuento OC #'||v_oc.numero, v_user);
  END IF;
  -- mig 473: "Cuenta Corriente" ya NO inserta un cargo: la deuda la carga la recepción (fn_cc_proveedor_cargo_recepcion).

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
REVOKE ALL ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text, numeric) TO authenticated, service_role;

-- ── 5. Pago desde la CC del proveedor: se imputa a la OC más vieja primero ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_proveedor_id uuid, p_medio text, p_monto numeric, p_caja_sesion_id uuid DEFAULT NULL, p_clave text DEFAULT NULL)
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
    v_imput := v_imput || jsonb_build_object('oc_id', v_oc.id, 'numero', v_oc.numero, 'monto', v_aplica);
    v_detalle := v_detalle || CASE WHEN v_detalle = '' THEN '' ELSE ', ' END
              || 'OC #' || v_oc.numero || ' $' || translate(to_char(v_aplica, 'FM999,999,990.00'), ',.', '.,');
    v_resto := v_resto - v_aplica;
  END LOOP;
  -- Lo que no tiene OC (deuda por encima de lo pedido) queda como pago a cuenta sin imputar.
  IF v_resto > v_eps THEN
    v_detalle := v_detalle || CASE WHEN v_detalle = '' THEN '' ELSE ', ' END
              || 'sin OC $' || translate(to_char(v_resto, 'FM999,999,990.00'), ',.', '.,');
  END IF;
  UPDATE proveedor_cc_movimientos SET descripcion = 'Pago a cuenta — ' || v_detalle WHERE id = v_mov_id;

  IF p_caja_sesion_id IS NOT NULL THEN
    INSERT INTO caja_movimientos(tenant_id, sesion_id, tipo, monto, concepto, cuenta_origen_id, usuario_id, moneda)
    VALUES (v_tenant, p_caja_sesion_id, CASE WHEN v_efectivo THEN 'egreso' ELSE 'egreso_informativo' END, v_monto,
            CASE WHEN v_efectivo THEN '' ELSE '[' || p_medio || '] ' END || 'Pago a ' || v_prov || ' — ' || v_detalle,
            CASE WHEN v_efectivo THEN NULL ELSE v_cuenta END, v_user, v_moneda);
  END IF;

  RETURN jsonb_build_object('ok', true, 'movimiento_id', v_mov_id, 'imputaciones', v_imput);
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_pago_proveedor(uuid, text, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, text, numeric, uuid, text) TO authenticated;

-- ── 6. Datos viejos (idempotente) ────────────────────────────────────────────────────────────────────────────────────
-- 6a. Anular los cargos que ponía "pasar a CC" (descripción 'CC OC #N — Xd', sin recepción) con un ajuste compensatorio.
INSERT INTO public.proveedor_cc_movimientos (tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, descripcion)
SELECT m.tenant_id, m.proveedor_id, m.oc_id, 'ajuste', -m.monto, m.moneda, CURRENT_DATE,
       'Anula "' || m.descripcion || '" — la deuda se carga al recibir (mig 473) [' || m.id || ']'
  FROM public.proveedor_cc_movimientos m
 WHERE m.tipo = 'oc' AND m.recepcion_id IS NULL AND m.oc_id IS NOT NULL AND m.descripcion LIKE 'CC OC #%'
   AND NOT EXISTS (SELECT 1 FROM public.proveedor_cc_movimientos a
                    WHERE a.tipo = 'ajuste' AND a.descripcion LIKE '%[' || m.id || ']');

-- 6b. Cargar las recepciones de OC ya confirmadas (su gasto "Compra OC #N").
INSERT INTO public.proveedor_cc_movimientos (tenant_id, proveedor_id, oc_id, recepcion_id, tipo, monto, moneda, fecha, descripcion, created_by)
SELECT g.tenant_id, o.proveedor_id, o.id, r.id, 'oc', g.monto, upper(COALESCE(g.moneda, 'ARS')), g.fecha,
       'Compra OC #' || o.numero || ' — recepción #' || r.numero, g.usuario_id
  FROM public.gastos g
  JOIN public.recepciones r ON r.id = g.recepcion_id AND r.tenant_id = g.tenant_id
  JOIN public.ordenes_compra o ON o.id = r.oc_id AND o.tenant_id = r.tenant_id
 WHERE g.monto > 0
ON CONFLICT (recepcion_id) WHERE tipo = 'oc' AND recepcion_id IS NOT NULL DO NOTHING;

-- 6c. Imputar los pagos viejos con OC (los pagos ya habían sumado a monto_pagado de esa OC).
INSERT INTO public.proveedor_pago_imputaciones (tenant_id, movimiento_id, oc_id, monto)
SELECT m.tenant_id, m.id, m.oc_id, -m.monto
  FROM public.proveedor_cc_movimientos m
 WHERE m.tipo = 'pago' AND m.oc_id IS NOT NULL AND m.monto < 0
   AND NOT EXISTS (SELECT 1 FROM public.proveedor_pago_imputaciones i WHERE i.movimiento_id = m.id);

-- 6d. Estado de pago de las OCs viejas: con el modelo anterior lo que pasaba a CC contaba como pagado para el estado
-- ('pagada' con monto_pagado < total). Ahora es deuda: vuelve a 'cuenta_corriente'.
UPDATE public.ordenes_compra o SET estado_pago = 'cuenta_corriente'
 WHERE o.estado_pago = 'pagada'
   AND o.monto_pagado + o.monto_descuento < COALESCE(o.monto_total, 0) - 0.5
   AND EXISTS (SELECT 1 FROM public.proveedor_cc_movimientos m
                WHERE m.oc_id = o.id AND m.tipo = 'oc' AND m.descripcion LIKE 'CC OC #%');
