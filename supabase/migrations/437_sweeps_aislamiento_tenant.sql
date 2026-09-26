-- 437 — Los sweeps que reciben un tenant por parámetro solo actúan sobre el negocio del usuario
--
-- 🔒 Aislamiento entre negocios. Encontrado el 2026-09-25 revisando el backlog de "cron para sweeps
-- lazy" (auditoría de procesos). Dos funciones SECURITY DEFINER ejecutables por `authenticated`
-- tomaban el negocio de un parámetro y NO lo comparaban con el del usuario:
--
--   · process_aging_profiles(p_tenant_id)   → cambia `estado_id` de inventario_lineas.
--   · liberar_reservas_vencidas(p_tenant_id) → cancela reservas vencidas, libera stock reservado y
--     acredita la seña en `cliente_creditos`.
--
-- Cualquier usuario logueado podía pasar el UUID de OTRO negocio y ejecutarlas sobre él. El daño
-- queda acotado a lo que el propio negocio ya haría por su configuración (reglas de aging / días de
-- vencimiento de reserva) —adelantarlo, no inventar datos—, pero es una escritura entre negocios
-- y toca inventario y créditos de clientes (REGLA #0). Verificado: grants iguales en DEV y PROD.
--
-- `recalcular_intereses_cc(p_tenant)` tiene el mismo parámetro pero YA validaba el tenant; solo se
-- alinea para que también mire `activo` (ver abajo).
--
-- Criterio: con usuario (auth.uid() NOT NULL) se exige p_tenant_id = get_user_tenant_id(), que
-- además mira `activo` (mig 433). Sin usuario es service_role / pg_cron (p. ej.
-- liberar_reservas_vencidas_all() desde la EF `cron-sweeps`, a la que `authenticated` no tiene
-- EXECUTE): pasa como antes. `anon` no tiene EXECUTE sobre ninguna de las tres.
--
-- De paso, process_aging_profile_single resolvía el negocio con un SELECT a `users` que no mira
-- `activo`: un usuario dado de baja todavía podía dispararla. Pasa a get_user_tenant_id(). Lo mismo
-- con el EXISTS de recalcular_intereses_cc (observación del migration-reviewer).
--
-- Cuerpos tomados con pg_get_functiondef de PROD (idénticos en DEV); solo cambian las líneas marcadas.

CREATE OR REPLACE FUNCTION public.liberar_reservas_vencidas(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dias       INTEGER;
  v_penal_pct  NUMERIC;
  v_count      INTEGER := 0;
  r            RECORD;
  it           RECORD;
  ln           RECORD;
  v_restante   NUMERIC;
  v_lib        NUMERIC;
  v_acreditar  NUMERIC;
BEGIN
  -- 🔒 mig 437: un usuario solo puede liberar las reservas de SU negocio. Sin usuario (auth.uid()
  -- NULL) es el sweep de service_role vía liberar_reservas_vencidas_all(): pasa.
  IF auth.uid() IS NOT NULL AND p_tenant_id IS DISTINCT FROM get_user_tenant_id() THEN
    RETURN 0;
  END IF;

  SELECT reserva_vencimiento_dias, COALESCE(reserva_penalidad_pct, 0)
    INTO v_dias, v_penal_pct
    FROM tenants WHERE id = p_tenant_id;
  IF v_dias IS NULL OR v_dias <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, cliente_id, COALESCE(monto_pagado, 0) AS monto_pagado, numero
    FROM ventas
    WHERE tenant_id = p_tenant_id
      AND estado = 'reservada'
      AND COALESCE(reservado_at, updated_at) < NOW() - (v_dias * INTERVAL '1 day')
  LOOP
    BEGIN
      FOR it IN
        SELECT vi.id AS item_id, vi.producto_id, vi.cantidad, p.tiene_series
        FROM venta_items vi
        JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = r.id
      LOOP
        IF it.tiene_series THEN
          UPDATE inventario_series
            SET reservado = false
            WHERE id IN (SELECT serie_id FROM venta_series WHERE venta_item_id = it.item_id);
        ELSE
          v_restante := it.cantidad;
          FOR ln IN
            SELECT id, cantidad_reservada FROM inventario_lineas
            WHERE producto_id = it.producto_id AND activo = true AND cantidad_reservada > 0
            ORDER BY created_at
          LOOP
            EXIT WHEN v_restante <= 0;
            v_lib := LEAST(ln.cantidad_reservada, v_restante);
            UPDATE inventario_lineas
              SET cantidad_reservada = cantidad_reservada - v_lib
              WHERE id = ln.id;
            v_restante := v_restante - v_lib;
          END LOOP;
        END IF;
      END LOOP;

      IF r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL THEN
        v_acreditar := round((GREATEST(0, r.monto_pagado * (1 - v_penal_pct / 100.0)))::numeric, 2);
        IF v_acreditar > 0.01 THEN
          INSERT INTO cliente_creditos (tenant_id, cliente_id, monto, origen, venta_id, nota)
          VALUES (p_tenant_id, r.cliente_id, v_acreditar, 'reserva_vencida', r.id,
            'Reserva vencida #' || COALESCE(r.numero::text, '?') ||
            CASE WHEN v_penal_pct > 0 THEN ' (penalidad ' || v_penal_pct || '%)' ELSE '' END);
        END IF;
      END IF;

      UPDATE ventas
        SET estado = 'cancelada',
            cancelado_at = NOW(),
            notas = COALESCE(notas, '') || ' · [Reserva vencida: stock liberado automaticamente el '
                    || to_char(NOW(), 'DD/MM/YYYY')
                    || CASE WHEN r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL
                            THEN '; seña acreditada al cliente' ELSE '' END || ']'
        WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_aging_profiles(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant UUID;
  v_linea         RECORD;
  v_estado_nuevo  UUID;
  v_estado_ant    TEXT;
  v_estado_nuevo_nombre TEXT;
  v_cambios       INT := 0;
  v_dias          INT;
BEGIN
  -- 🔒 mig 437: con usuario, SIEMPRE su propio negocio (y solo si está activo): antes cualquier
  -- usuario podía pasar el p_tenant_id de otro negocio y cambiarle estados de inventario. Sin usuario
  -- (auth.uid() NULL) es service_role / pg_cron: usa p_tenant_id.
  IF auth.uid() IS NOT NULL THEN
    v_target_tenant := get_user_tenant_id();
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM v_target_tenant THEN
      RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
    END IF;
  ELSE
    v_target_tenant := p_tenant_id;
  END IF;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;

  FOR v_linea IN
    SELECT
      il.id,
      il.estado_id,
      il.fecha_vencimiento,
      il.tenant_id,
      il.producto_id,
      p.aging_profile_id,
      p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE
      AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id IS NOT NULL
      AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;

    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = v_linea.aging_profile_id
      AND apr.dias >= v_dias
    ORDER BY apr.dias ASC
    LIMIT 1;

    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant        FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nombre FROM estados_inventario WHERE id = v_estado_nuevo;

      PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;

      INSERT INTO actividad_log (
        tenant_id, usuario_id, usuario_nombre,
        entidad, entidad_id, entidad_nombre,
        accion, campo, valor_anterior, valor_nuevo, pagina
      ) VALUES (
        v_linea.tenant_id,
        NULL, 'Sistema (Aging)',
        'inventario_linea', v_linea.id::TEXT, v_linea.prod_nombre,
        'cambio_estado_auto',
        'estado',
        COALESCE(v_estado_ant, 'Sin estado'),
        COALESCE(v_estado_nuevo_nombre, 'Sin estado'),
        '/aging-auto'
      );

      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cambios', v_cambios,
    'tenant_id', v_target_tenant,
    'procesado_en', NOW()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_aging_profile_single(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_tenant    UUID;
  v_linea            RECORD;
  v_estado_nuevo     UUID;
  v_estado_ant       TEXT;
  v_estado_nuevo_nom TEXT;
  v_cambios          INT := 0;
  v_dias             INT;
BEGIN
  -- 🔒 mig 437: get_user_tenant_id() mira `activo` (mig 433); el SELECT a users no lo hacía.
  v_target_tenant := get_user_tenant_id();
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aging_profiles WHERE id = p_profile_id AND tenant_id = v_target_tenant) THEN
    RETURN jsonb_build_object('error', 'Perfil no encontrado', 'cambios', 0);
  END IF;
  FOR v_linea IN
    SELECT il.id, il.estado_id, il.fecha_vencimiento, il.tenant_id, il.producto_id, p.aging_profile_id, p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id = p_profile_id AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;
    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = p_profile_id AND apr.dias >= v_dias
    ORDER BY apr.dias ASC LIMIT 1;
    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nom FROM estados_inventario WHERE id = v_estado_nuevo;
      PERFORM set_config('genesis360.aprobando_estado_inventario', 'on', true);
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;
      INSERT INTO actividad_log (tenant_id, entidad, entidad_id, entidad_nombre, accion, campo, valor_anterior, valor_nuevo, pagina)
      VALUES (v_linea.tenant_id, 'inventario_linea', v_linea.id, v_linea.prod_nombre, 'cambio_estado', 'estado', COALESCE(v_estado_ant, 'sin estado'), v_estado_nuevo_nom, 'aging_profile_single');
      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('cambios', v_cambios, 'profile_id', p_profile_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_intereses_cc(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pct NUMERIC;
  v_count INT := 0;
BEGIN
  -- 🔒 mig 437: get_user_tenant_id() mira `activo` (mig 433); el EXISTS sobre users no lo hacía.
  -- Sin usuario sigue devolviendo 0, igual que antes (el sweep usa recalcular_intereses_cc_all()).
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM get_user_tenant_id() THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(cc_interes_mensual_pct, 0) INTO v_pct FROM tenants WHERE id = p_tenant;
  IF v_pct IS NULL OR v_pct <= 0 THEN
    UPDATE ventas SET interes_cc = 0
      WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0;
    RETURN 0;
  END IF;

  UPDATE ventas v SET interes_cc = ROUND(
      GREATEST(v.total - v.monto_pagado, 0)
      * (v_pct / 100.0)
      * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
    , 2)
  WHERE v.tenant_id = p_tenant
    AND v.es_cuenta_corriente = TRUE
    AND v.estado <> 'cancelada'
    AND v.fecha_vencimiento_cc IS NOT NULL
    AND (v.total - v.monto_pagado) > 0.5;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE ventas SET interes_cc = 0
    WHERE tenant_id = p_tenant AND es_cuenta_corriente = TRUE AND interes_cc <> 0
      AND ((total - monto_pagado) <= 0.5
           OR fecha_vencimiento_cc IS NULL
           OR fecha_vencimiento_cc >= CURRENT_DATE);

  RETURN v_count;
END;
$function$;

-- CREATE OR REPLACE conserva los GRANT existentes: `authenticated` sigue pudiendo ejecutar las cuatro
-- (la app las llama desde VentasPage y ConfigPage), ahora limitadas a su propio negocio.
