-- 236 — RPC clave-gated para dar de baja deuda incobrable (REGLA #0 obligación #3: guard server-side).
--
-- Contexto (H1, tests/specs/uat-app.md): "dar de baja incobrable" condona TODA la deuda CC del cliente
-- + genera un gasto "Deudor incobrable". Se gateaba SOLO en el frontend (rol + clave maestra), la clave
-- se VERIFICABA client-side y se OMITÍA si el tenant no la tenía configurada → bypass por bundle cacheado
-- o escritura por API. Este RPC SECURITY DEFINER mueve la decisión al server: verifica rol + clave y hace
-- el write-off atómico.
--
-- Decisiones (fidelidad EXACTA con ClientesPage.confirmarIncobrable):
--   - Rol permitido = puedeIncobrable de la UI: DUEÑO / SUPER_USUARIO / ADMIN (NO SUPERVISOR — la UI
--     tampoco ofrece el botón a SUPERVISOR; el trigger de mig 235 sí permite SUPERVISOR para write-offs
--     genéricos, pero el incobrable es más restrictivo).
--   - Clave: verificar_clave_maestra(tenant, p_clave) — devuelve TRUE si el tenant NO tiene clave
--     configurada (sin cambio de comportamiento para esos tenants), pero ahora se valida SERVER-side
--     (cierra el bypass del cliente cuando SÍ hay clave configurada).
--   - Ventas alcanzadas (espeja "pendientes" = ventasCC sin condonar): es_cuenta_corriente,
--     estado in ('despachada','facturada'), saldo (total - monto_pagado) > 0.5, sin tag de write-off previo.
--   - Por cada venta: monto_pagado = total; si saldo2 (total - Σ medios no-CC) > 0.5 agrega el tag
--     'Incobrable' (monto=saldo2, motivo, por, at) y suma al total dado de baja.
--   - Si el total > 0.5: inserta el gasto "Deudor incobrable" (categoría 'Deudores incobrables').
--   - El trigger de mig 235 (rol para write-off) re-valida en cada UPDATE (defense-in-depth; pasa porque
--     el RPC ya exigió un rol del subconjunto permitido).
--   - SECURITY DEFINER ⇒ todo se scopea explícitamente por v_tenant (la RLS no protege adentro).
--
-- Devuelve jsonb { total_incobrable, ventas_afectadas }.

CREATE OR REPLACE FUNCTION public.marcar_incobrable(p_cliente_id uuid, p_clave text, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_rol     text := public.get_user_role();
  v_user    uuid := auth.uid();
  v_nombre  text;
  v_total   numeric := 0;
  v_count   int := 0;
  v_venta   record;
  v_medios  jsonb;
  v_saldo   numeric;
  v_motivo  text := NULLIF(btrim(p_motivo), '');
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant en la sesión'; END IF;
  IF v_rol IS DISTINCT FROM 'DUEÑO'
     AND v_rol IS DISTINCT FROM 'SUPER_USUARIO'
     AND v_rol IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'No autorizado: dar de baja incobrable requiere rol DUEÑO/ADMIN.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.verificar_clave_maestra(v_tenant, p_clave) THEN
    RAISE EXCEPTION 'Clave maestra incorrecta.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT nombre INTO v_nombre FROM public.clientes WHERE id = p_cliente_id AND tenant_id = v_tenant;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado en el tenant'; END IF;

  FOR v_venta IN
    SELECT id, total, monto_pagado, medio_pago
      FROM public.ventas
     WHERE tenant_id = v_tenant
       AND cliente_id = p_cliente_id
       AND es_cuenta_corriente = TRUE
       AND estado IN ('despachada','facturada')
       AND (COALESCE(total,0) - COALESCE(monto_pagado,0)) > 0.5
  LOOP
    BEGIN v_medios := COALESCE(v_venta.medio_pago, '[]')::jsonb; EXCEPTION WHEN others THEN v_medios := '[]'::jsonb; END;
    IF jsonb_typeof(v_medios) <> 'array' THEN v_medios := '[]'::jsonb; END IF;

    -- saltar las ya condonadas/incobrables (espeja !condonada)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_medios) e
               WHERE e->>'tipo' IN ('Condonación CC','Cancelación CC','Incobrable')) THEN
      CONTINUE;
    END IF;

    -- saldo2 = total - Σ medios no-CC (igual que el front: lo que falta cobrar de verdad)
    SELECT COALESCE(v_venta.total,0) - COALESCE(SUM((e->>'monto')::numeric), 0)
      INTO v_saldo
      FROM jsonb_array_elements(v_medios) e
     WHERE e->>'tipo' <> 'Cuenta Corriente';

    IF v_saldo > 0.5 THEN
      v_medios := v_medios || jsonb_build_object(
        'tipo','Incobrable', 'monto', v_saldo, 'motivo', v_motivo,
        'por', v_user::text,
        'at', to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      v_total := v_total + v_saldo;
    END IF;

    UPDATE public.ventas
       SET monto_pagado = COALESCE(v_venta.total,0), medio_pago = v_medios::text
     WHERE id = v_venta.id;
    v_count := v_count + 1;
  END LOOP;

  IF v_total > 0.5 THEN
    INSERT INTO public.gastos (tenant_id, descripcion, monto, categoria, fecha, usuario_id)
    VALUES (v_tenant,
            'Deudor incobrable: ' || v_nombre || CASE WHEN v_motivo IS NOT NULL THEN ' — ' || v_motivo ELSE '' END,
            round(v_total * 100) / 100,
            'Deudores incobrables',
            (now() AT TIME ZONE 'utc')::date,
            v_user);
  END IF;

  RETURN jsonb_build_object('total_incobrable', v_total, 'ventas_afectadas', v_count);
END $function$;

REVOKE ALL ON FUNCTION public.marcar_incobrable(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_incobrable(uuid, text, text) TO authenticated;
