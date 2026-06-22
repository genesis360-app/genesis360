-- 238 — RPC atómico y clave-gated para marcar envíos pagados al courier (REGLA #0 obligación #3).
--
-- Contexto (H2, tests/specs/uat-app.md): el pago a courier sobre el umbral exigía clave maestra SOLO si el
-- tenant tenía clave seteada (si no, pasaba sin segunda firma, en silencio), y el enforcement + las
-- escrituras vivían en el frontend (EnviosPage.marcarPagados), bypasseable. Este RPC SECURITY DEFINER
-- mueve la decisión y las escrituras al server, atómicas:
--   - doble firma (clave) cuando el total del pago supera el umbral, CERRANDO el hueco "se omite si no hay
--     clave" → si supera el umbral y el tenant NO tiene clave, BLOQUEA y pide configurarla.
--   - escrituras: un gasto contable por courier (con desglose de IVA crédito) + caja_movimientos
--     (egreso/egreso_informativo) + marca los envíos como pagados (costo_pagado, fecha/medio, gasto_id).
--
-- Fidelidad con marcarPagados: agrupa por courier (espeja agruparPagosPorCourier), desglosa IVA
-- (neto = bruto/(1+pct/100), iva = bruto − neto; espeja desgloseIvaFlete), genera gasto solo si
-- p_genera_gasto y total > 0. El courier NO tiene guard de rol en la UI → el RPC tampoco lo agrega.
-- SECURITY DEFINER ⇒ todo se scopea por v_tenant; la caja_sesion se valida del tenant.
--
-- Devuelve jsonb { envios, gasto_total, grupos }.

CREATE OR REPLACE FUNCTION public.marcar_envios_pagados(
  p_envio_ids uuid[],
  p_clave text DEFAULT NULL,
  p_medio text DEFAULT 'Efectivo',
  p_fecha date DEFAULT NULL,
  p_caja_sesion_id uuid DEFAULT NULL,
  p_genera_gasto boolean DEFAULT true,
  p_iva_pct numeric DEFAULT 21,
  p_categoria_flete_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_user       uuid := auth.uid();
  v_eps        numeric := 0.5;
  v_totalpago  numeric := 0;
  v_n_envios   int := 0;
  v_umbral     numeric;
  v_clave_real text;
  v_es_efectivo boolean := (p_medio = 'Efectivo');
  v_fecha      date := COALESCE(p_fecha, CURRENT_DATE);
  v_grp        record;
  v_neto       numeric;
  v_iva        numeric;
  v_gasto_id   uuid;
  v_gasto_total numeric := 0;
  v_grupos     int := 0;
  v_concepto   text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF p_envio_ids IS NULL OR array_length(p_envio_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Seleccioná al menos un envío';
  END IF;

  SELECT COALESCE(SUM(COALESCE(costo_cotizado,0)),0), COUNT(*)
    INTO v_totalpago, v_n_envios
    FROM public.envios WHERE id = ANY(p_envio_ids) AND tenant_id = v_tenant;
  IF v_n_envios = 0 THEN RAISE EXCEPTION 'Envíos no encontrados para el tenant'; END IF;

  IF p_caja_sesion_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Caja inválida para el tenant';
  END IF;

  -- C4 — doble firma server-side: si supera el umbral, exige clave; si el tenant NO tiene clave, BLOQUEA.
  v_umbral := (SELECT envio_pago_doble_firma_umbral FROM public.tenants WHERE id = v_tenant);
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_totalpago >= v_umbral THEN
    SELECT clave_maestra INTO v_clave_real FROM public.tenants WHERE id = v_tenant;
    IF v_clave_real IS NULL OR length(trim(v_clave_real)) = 0 THEN
      RAISE EXCEPTION 'Pago de $% sobre el umbral de doble firma ($%): configurá una clave maestra (Config → Seguridad) para autorizarlo.',
        round(v_totalpago), round(v_umbral) USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
      RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Un gasto por courier (proveedor = courier) + su caja + marca de pago de sus envíos.
  FOR v_grp IN
    SELECT s.courier,
           array_agg(s.id) AS ids,
           SUM(COALESCE(s.costo_cotizado,0)) AS total,
           (array_agg(s.sucursal_id) FILTER (WHERE s.sucursal_id IS NOT NULL))[1] AS sucursal_id,
           string_agg('#'||COALESCE(s.numero::text, right(s.id::text,6)), ', ') AS numeros,
           COUNT(*) AS n
    FROM (SELECT id, COALESCE(NULLIF(btrim(courier),''),'Courier') AS courier, costo_cotizado, sucursal_id, numero
          FROM public.envios WHERE id = ANY(p_envio_ids) AND tenant_id = v_tenant) s
    GROUP BY s.courier
  LOOP
    v_grupos := v_grupos + 1;
    v_gasto_id := NULL;

    IF p_genera_gasto AND v_grp.total > v_eps THEN
      IF p_iva_pct IS NULL OR p_iva_pct <= 0 THEN
        v_iva := 0;
      ELSE
        v_neto := v_grp.total / (1 + p_iva_pct / 100);
        v_iva  := round(v_grp.total - v_neto, 2);
      END IF;

      INSERT INTO public.gastos(
        tenant_id, descripcion, monto, categoria, categoria_id, tipo_iva, iva_monto, alicuota_iva,
        iva_deducible, deduce_ganancias, gasto_negocio, medio_pago, fecha, sucursal_id, usuario_id,
        monto_pagado, estado_pago, notas)
      VALUES (
        v_tenant,
        'Flete '||v_grp.courier||' — '||v_grp.n||' envío'||CASE WHEN v_grp.n > 1 THEN 's' ELSE '' END,
        v_grp.total, 'Transporte y fletes', p_categoria_flete_id,
        CASE WHEN p_iva_pct > 0 THEN p_iva_pct::text ELSE NULL END,
        CASE WHEN v_iva > 0 THEN v_iva ELSE NULL END,
        CASE WHEN p_iva_pct > 0 THEN p_iva_pct ELSE NULL END,
        (p_iva_pct > 0), true, true,
        jsonb_build_array(jsonb_build_object('tipo', p_medio, 'monto', v_grp.total))::text,
        v_fecha, v_grp.sucursal_id, v_user, v_grp.total, 'pagado',
        'Pago a courier (Envíos): '||v_grp.numeros)
      RETURNING id INTO v_gasto_id;
      v_gasto_total := v_gasto_total + v_grp.total;

      IF p_caja_sesion_id IS NOT NULL THEN
        v_concepto := 'Flete '||v_grp.courier||' — '||v_grp.n||' envío(s)';
        INSERT INTO public.caja_movimientos(tenant_id, sesion_id, tipo, concepto, monto, usuario_id)
        VALUES (v_tenant, p_caja_sesion_id,
                CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
                CASE WHEN v_es_efectivo THEN v_concepto ELSE '['||p_medio||'] '||v_concepto END,
                v_grp.total, v_user);
      END IF;
    END IF;

    UPDATE public.envios
       SET costo_pagado = true, fecha_pago_courier = v_fecha, medio_pago_courier = p_medio,
           gasto_id = COALESCE(v_gasto_id, gasto_id)
     WHERE id = ANY(v_grp.ids) AND tenant_id = v_tenant;
  END LOOP;

  RETURN jsonb_build_object('envios', v_n_envios, 'gasto_total', v_gasto_total, 'grupos', v_grupos);
END $function$;

REVOKE ALL ON FUNCTION public.marcar_envios_pagados(uuid[],text,text,date,uuid,boolean,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_envios_pagados(uuid[],text,text,date,uuid,boolean,numeric,uuid) TO authenticated;
