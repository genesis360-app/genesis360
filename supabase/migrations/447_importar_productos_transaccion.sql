-- 447 — Importar productos en UNA transacción (todo o nada)
--
-- Decisión de Fede/GO (D3-a, 2026-09-30/10-01): la importación tiene dos pasos —vista previa completa con el motivo de
-- cada error, después un botón aparte para cargar— y la carga es TODO O NADA. Hasta ahora el navegador escribía fila
-- por fila: si una fallaba a mitad de camino (error de la base, corte de red, cerrar la pestaña) las anteriores ya
-- habían quedado guardadas y el archivo quedaba cargado a medias.
--
-- `fn_importar_productos` recibe las filas YA armadas por el navegador (la conversión de moneda, el "solo las columnas
-- que trae el archivo" de D-3 y el empaque siguen en src/pages/ImportarProductosPage.tsx, que es lo que está testeado)
-- y las aplica en una sola transacción. Cualquier error → se deshace todo y el mensaje dice qué fila falló.
--
-- SECURITY INVOKER a propósito: rigen las mismas policies de `productos` y el trigger `fn_productos_rol_guard` que hoy
-- (dueño/supervisor/…; un CAJERO no puede importar), más un guard explícito de rol al entrar. El tenant sale de la
-- sesión, nunca del payload, y solo se escriben columnas de una lista blanca (no `tenant_id`, `stock_actual`, `id`, …).
--
-- Rendimiento (el rol `authenticated` corta a los 8 s): escribir con una sentencia POR FILA costaba 2-3 ms por fila
-- (2000 altas = 3,6 s; 2000 cambios de precio = 5,2 s, medido en DEV), así que se escribe por CONJUNTO: una sentencia
-- por grupo de filas con la misma acción y las mismas columnas. Si esa sentencia falla, recién ahí se reintenta fila
-- por fila para encontrar la culpable y decir su número. Tope: 5000 filas por archivo.
--
-- Payload: p_filas = [{ "fila": 12, "accion": "crear"|"actualizar", "sku": "...", "campos": {...},
--                       "presentaciones": [...] | null }]
-- p_cancelar_programados: si es true, cancela (en esta misma transacción) los precios programados pendientes de los
-- productos a los que el archivo les CAMBIA `precio_venta` (C-3; la pregunta se le hace al usuario antes).

CREATE OR REPLACE FUNCTION public.fn_importar_productos(p_filas jsonb, p_cancelar_programados boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  -- Columnas que el importador puede escribir. Cualquier otra clave del payload hace fallar la carga.
  c_permitidas CONSTANT text[] := ARRAY[
    'nombre', 'sku', 'codigo_barras', 'categoria_id', 'proveedor_id',
    'precio_costo', 'precio_costo_usd', 'moneda_costo', 'precio_costo_moneda',
    'precio_venta', 'precio_usd', 'moneda_venta', 'precio_venta_moneda',
    'stock_minimo', 'unidad_medida', 'descripcion', 'notas', 'activo', 'alicuota_iva', 'margen_objetivo',
    'tiene_series', 'tiene_lote', 'tiene_vencimiento', 'regla_inventario', 'es_kit'
  ];
  v_tenant      uuid := public.get_user_tenant_id();
  v_item        jsonb;
  v_norm        jsonb[] := '{}';
  v_fila        int;
  v_accion      text;
  v_sku         text;
  v_campos      jsonb;
  v_cols        text[];
  v_extra       text[];
  v_id          uuid;
  v_n           int;
  v_mapa        jsonb;            -- SKU existente (en mayúsculas) → [ids]
  v_creados_ids jsonb := '{}';    -- SKU creado → id (para el empaque)
  v_grupo       record;
  v_sql         text;
  v_res         jsonb;
  v_creados     int := 0;
  v_actualiz    int := 0;
  v_cancelados  int := 0;
  v_pp          uuid;
  v_constraint  text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Guard explícito (no alcanza con el trigger de `productos`): una fila que solo trae empaque no hace UPDATE de
  -- `productos`, y `fn_presentaciones_guardar` valida tenant pero no rol.
  IF NOT public.auth_puede_editar_modulo('inventario') THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede importar productos.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_filas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato inválido: se esperaba una lista de filas.';
  END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'El archivo tiene % filas; el máximo por importación es 5000. Dividilo en partes.', jsonb_array_length(p_filas);
  END IF;

  -- SKU existentes → ids, en UNA consulta. Sin distinguir mayúsculas, igual que la vista previa (hay SKU viejos en
  -- minúsculas). Buscarlos fila por fila costaba ~2 ms por fila: no hay índice sobre upper(sku).
  SELECT coalesce(jsonb_object_agg(u, ids), '{}'::jsonb) INTO v_mapa
    FROM (SELECT upper(p.sku) AS u, jsonb_agg(p.id) AS ids
            FROM public.productos p
           WHERE p.tenant_id = v_tenant
             AND upper(p.sku) IN (SELECT upper(trim(e->>'sku')) FROM jsonb_array_elements(p_filas) e
                                   WHERE e->>'accion' = 'actualizar')
           GROUP BY 1) s;

  -- UN bloque de excepción para toda la carga: ante cualquier error se deshace TODO, y `v_fila`/`v_sku` dicen qué
  -- fila falló.
  BEGIN
    -- 1) Validar y normalizar todas las filas, sin escribir nada.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
      v_fila   := CASE WHEN v_item->>'fila' ~ '^\d{1,9}$' THEN (v_item->>'fila')::int END;
      v_accion := v_item->>'accion';
      v_sku    := upper(trim(coalesce(v_item->>'sku', '')));
      v_campos := coalesce(v_item->'campos', '{}'::jsonb);

      IF v_sku = '' THEN RAISE EXCEPTION 'falta el SKU'; END IF;
      IF jsonb_typeof(v_campos) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'formato de campos inválido'; END IF;
      IF v_accion IS NULL OR v_accion NOT IN ('crear', 'actualizar') THEN
        RAISE EXCEPTION 'acción inválida "%"', coalesce(v_accion, '');
      END IF;
      -- En un alta el SKU es el de la fila (normalizado); al actualizar identifica la fila y nunca se renombra.
      v_campos := CASE WHEN v_accion = 'crear' THEN v_campos || jsonb_build_object('sku', v_sku) ELSE v_campos - 'sku' END;

      SELECT array_agg(k ORDER BY k) INTO v_cols FROM jsonb_object_keys(v_campos) k;
      SELECT array_agg(k) INTO v_extra FROM unnest(coalesce(v_cols, '{}')) k WHERE NOT (k = ANY (c_permitidas));
      IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION 'columna no permitida: %', array_to_string(v_extra, ', ');
      END IF;

      v_id := NULL;
      IF v_accion = 'actualizar' THEN
        v_n := coalesce(jsonb_array_length(v_mapa->v_sku), 0);
        IF v_n = 0 THEN
          RAISE EXCEPTION 'el SKU ya no existe (¿se borró después de la vista previa?)';
        ELSIF v_n > 1 THEN
          RAISE EXCEPTION 'hay % productos con ese SKU escrito con distintas mayúsculas; unificalos antes de importar', v_n;
        END IF;
        v_id := (v_mapa->v_sku->>0)::uuid;
        IF v_cols IS NULL AND jsonb_typeof(v_item->'presentaciones') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'la fila no trae ninguna columna para actualizar';
        END IF;
      ELSIF v_cols = ARRAY['sku'] THEN
        RAISE EXCEPTION 'la fila no trae datos';
      END IF;

      v_norm := v_norm || jsonb_build_object(
        'fila', v_fila, 'accion', v_accion, 'sku', v_sku, 'campos', v_campos, '_id', v_id,
        'firma', array_to_string(v_cols, ','), 'presentaciones', v_item->'presentaciones');
    END LOOP;

    -- 2) Precios programados (C-3): solo donde el archivo CAMBIA el precio de venta.
    v_fila := NULL; v_sku := NULL;
    IF p_cancelar_programados THEN
      FOR v_pp IN
        SELECT pp.id
          FROM unnest(v_norm) e
          JOIN public.productos p ON p.id = (e->>'_id')::uuid
          JOIN public.precios_programados pp ON pp.producto_id = p.id AND pp.estado = 'pendiente'
         WHERE e->>'accion' = 'actualizar' AND e->'campos' ? 'precio_venta'
           AND (e->'campos'->>'precio_venta')::numeric IS DISTINCT FROM p.precio_venta
      LOOP
        PERFORM public.fn_cancelar_precio_programado(v_pp);
        v_cancelados := v_cancelados + 1;
      END LOOP;
    END IF;

    -- 3) Escribir por CONJUNTO: una sentencia por (acción, columnas).
    FOR v_grupo IN
      SELECT e->>'accion' AS accion, e->>'firma' AS firma, jsonb_agg(e) AS items
        FROM unnest(v_norm) e
       WHERE coalesce(e->>'firma', '') <> ''
       GROUP BY 1, 2
    LOOP
      IF v_grupo.accion = 'crear' THEN
        v_sql := format(
          $f$WITH ins AS (
               INSERT INTO public.productos (tenant_id, %1$s)
               SELECT $1, %2$s
                 FROM jsonb_array_elements($2) e
                 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.productos, e->'campos') r
               RETURNING id, upper(sku) AS u)
             SELECT coalesce(jsonb_object_agg(u, id), '{}'::jsonb) FROM ins$f$,
          (SELECT string_agg(format('%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k),
          (SELECT string_agg(format('r.%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      ELSE
        v_sql := format(
          $f$WITH upd AS (
               UPDATE public.productos p SET %1$s
                 FROM (SELECT (e->>'_id')::uuid AS _destino,
                              jsonb_populate_record(NULL::public.productos, e->'campos') AS x
                         FROM jsonb_array_elements($2) e
                       OFFSET 0) r
                WHERE p.id = r._destino AND p.tenant_id = $1
               RETURNING p.id)
             SELECT jsonb_build_object('n', count(*)) FROM upd$f$,
          (SELECT string_agg(format('%1$I = (r.x).%1$I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      END IF;

      BEGIN
        EXECUTE v_sql INTO v_res USING v_tenant, v_grupo.items;
      EXCEPTION WHEN OTHERS THEN
        -- Buscar la fila culpable de a una, solo para el mensaje (igual se deshace todo). El error de esa fila sale al
        -- bloque de afuera, que lo devuelve con su número.
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_grupo.items) LOOP
          v_fila := (v_item->>'fila')::int;
          v_sku  := v_item->>'sku';
          EXECUTE v_sql USING v_tenant, jsonb_build_array(v_item);
        END LOOP;
        v_fila := NULL; v_sku := NULL;
        RAISE;   -- ninguna falló sola: el problema es entre filas del mismo archivo
      END;

      IF v_grupo.accion = 'crear' THEN
        v_creados_ids := v_creados_ids || v_res;
        v_creados := v_creados + jsonb_array_length(v_grupo.items);
      ELSIF (v_res->>'n')::int <> jsonb_array_length(v_grupo.items) THEN
        RAISE EXCEPTION 'se actualizaron % de % productos; alguno se borró o es de otro negocio',
          v_res->>'n', jsonb_array_length(v_grupo.items);
      END IF;
    END LOOP;

    -- Las filas que solo traen empaque también cuentan como actualizadas.
    SELECT count(*) INTO v_actualiz FROM unnest(v_norm) e WHERE e->>'accion' = 'actualizar';

    -- 4) Empaque (árbol de presentaciones), por fila.
    FOR v_item IN SELECT e FROM unnest(v_norm) e WHERE jsonb_typeof(e->'presentaciones') = 'array' LOOP
      v_fila := (v_item->>'fila')::int;
      v_sku  := v_item->>'sku';
      v_id   := coalesce((v_item->>'_id')::uuid, (v_creados_ids->>(v_item->>'sku'))::uuid);
      IF v_id IS NULL THEN RAISE EXCEPTION 'no se encontró el producto para guardar el empaque'; END IF;
      PERFORM public.fn_presentaciones_guardar(v_id, v_item->'presentaciones');
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    -- Re-lanzar con el número de fila: la excepción sale de la función y Postgres deshace TODA la importación.
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION '%', concat_ws(': ',
        CASE WHEN v_fila IS NOT NULL OR v_sku IS NOT NULL
             THEN format('Fila %s (SKU %s)', coalesce(v_fila::text, '?'), coalesce(v_sku, '?')) END,
        CASE
          WHEN SQLSTATE = '23505' AND v_constraint ILIKE '%sku%' THEN 'ya existe un producto con ese SKU'
          WHEN SQLSTATE = '23505' THEN format('dato duplicado (%s)', v_constraint)
          ELSE SQLERRM
        END)
      USING ERRCODE = SQLSTATE;
  END;

  RETURN jsonb_build_object('creados', v_creados, 'actualizados', v_actualiz, 'programados_cancelados', v_cancelados);
END;
$$;

COMMENT ON FUNCTION public.fn_importar_productos(jsonb, boolean) IS
  'Importación de productos todo-o-nada (mig 447, D3-a). INVOKER: rigen RLS y fn_productos_rol_guard.';

REVOKE ALL ON FUNCTION public.fn_importar_productos(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_productos(jsonb, boolean) TO authenticated;
