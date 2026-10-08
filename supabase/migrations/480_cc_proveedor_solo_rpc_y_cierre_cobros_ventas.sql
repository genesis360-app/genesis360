-- 480 — (1) La cuenta corriente de proveedores se escribe SOLO por funciones de la base; (2) el cierre contable deja
-- COBRAR ventas viejas (decisiones de GO 2026-10-08). REGLA #0.
--
-- (1) La policy `proveedor_cc_movimientos_write_gastos` (FOR ALL) dejaba que la pantalla insertara, editara o borrara
--     cualquier movimiento de la CC (cualquier tipo, cualquier monto, cualquier moneda). Todo lo que mueve plata con
--     proveedores ya pasa por funciones SECURITY DEFINER (registrar_pago_oc, registrar_pago_proveedor,
--     revertir_cheque_propio, el cargo de la recepción); quedaban dos inserts de la pantalla, los dos notas de crédito:
--     la NC manual y la devolución a proveedor con crédito en CC (que además NO chequeaba el error: si fallaba, la
--     mercadería ya había salido del stock y el crédito no quedaba, en silencio). Ahora: `registrar_nc_proveedor`, mismo
--     permiso que la policy (módulo Gastos en "editar"), y la tabla queda de solo lectura para los usuarios.
-- (2) `trg_ventas_periodo_cerrado` bloqueaba todo UPDATE de una venta de un período cerrado, también COBRARLA hoy
--     (cobranza de CC, condonación, interés por mora del cron, cobro por link de MP). Mismo criterio que la mig 479 para
--     OCs y gastos: el cierre protege el CONTENIDO de la venta (ítems, total, cliente, fiscal…), no su estado de cobro.
--     ⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR — consulta al contador C-25.

-- (1) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_nc_proveedor(
  p_proveedor_id uuid,
  p_monto numeric,
  p_numero text DEFAULT NULL,
  p_descripcion text DEFAULT NULL,
  p_adjunto_url text DEFAULT NULL,
  p_oc_id uuid DEFAULT NULL,
  p_moneda text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_monto  numeric := round(COALESCE(p_monto, 0), 2);
  v_oc     record;
  v_oc_moneda text;   -- NULL sin OC (un record sin asignar no se puede leer)
  v_moneda text;
  v_id     uuid := gen_random_uuid();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  -- Mismo permiso que tenía la policy de escritura de la tabla (mig 405): el módulo Gastos en "editar".
  IF NOT public.auth_puede_editar_modulo('gastos') THEN
    RAISE EXCEPTION 'No autorizado para registrar notas de crédito de proveedores.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'Ingresá un monto válido' USING ERRCODE = 'check_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM proveedores WHERE id = p_proveedor_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Proveedor no encontrado en el negocio';
  END IF;
  IF p_oc_id IS NOT NULL THEN
    SELECT id, proveedor_id, COALESCE(moneda, 'ARS') AS moneda INTO v_oc
      FROM ordenes_compra WHERE id = p_oc_id AND tenant_id = v_tenant;
    IF v_oc.id IS NULL THEN RAISE EXCEPTION 'OC no encontrada en el negocio'; END IF;
    IF v_oc.proveedor_id IS DISTINCT FROM p_proveedor_id THEN
      RAISE EXCEPTION 'La OC es de otro proveedor.' USING ERRCODE = 'check_violation';
    END IF;
    v_oc_moneda := v_oc.moneda;
  END IF;
  -- La moneda de la OC si viene de una; si no, la indicada; si no, ARS (como el default de la tabla).
  v_moneda := upper(COALESCE(v_oc_moneda, NULLIF(trim(p_moneda), ''), 'ARS'));

  INSERT INTO proveedor_cc_movimientos(id, tenant_id, proveedor_id, oc_id, tipo, monto, moneda, fecha, descripcion,
                                       nc_numero, adjunto_url, created_by)
  VALUES (v_id, v_tenant, p_proveedor_id, p_oc_id, 'nota_credito', -v_monto, v_moneda, CURRENT_DATE,
          COALESCE(NULLIF(trim(p_descripcion), ''), 'Nota de crédito' || COALESCE(' ' || NULLIF(trim(p_numero), ''), '')),
          NULLIF(trim(p_numero), ''), NULLIF(trim(p_adjunto_url), ''), auth.uid());
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_nc_proveedor(uuid, numeric, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_nc_proveedor(uuid, numeric, text, text, text, uuid, text) TO authenticated;

DROP POLICY IF EXISTS proveedor_cc_movimientos_write_gastos ON public.proveedor_cc_movimientos;
REVOKE ALL ON public.proveedor_cc_movimientos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.proveedor_cc_movimientos FROM authenticated;
GRANT SELECT ON public.proveedor_cc_movimientos TO authenticated;

-- (2) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ventas_periodo_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  -- mig 480 (decisión de GO 2026-10-08): cobrar hoy una venta de un período cerrado (cobranza de CC, condonación, interés
  -- por mora, cobro por link) es un hecho de hoy; el cierre protege el contenido de la venta, no su estado de cobro.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['monto_pagado', 'medio_pago', 'interes_cc', 'id_pago_externo',
        'money_release_date', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['monto_pagado', 'medio_pago', 'interes_cc', 'id_pago_externo',
        'money_release_date', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar ventas anteriores.', v_cierre USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $function$;
