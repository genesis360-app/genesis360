-- 448 — Importar clientes en UNA transacción (todo o nada)
--
-- Mismo criterio que la mig 447 (productos), decisión D3-a de Fede/GO: vista previa completa → botón aparte para
-- cargar → TODO O NADA. El importador de clientes escribía fila por fila desde el navegador y además:
--   · al actualizar un cliente existente escribía TODAS las columnas, así que una columna ausente o vacía en el archivo
--     BORRABA el dato que tenía (email, teléfono, notas…). Ahora el navegador manda solo las columnas con valor y esta
--     función escribe solo esas;
--   · los errores se contaban sin decir cuál fila ni por qué.
--
-- SECURITY INVOKER: rige la policy `clientes_tenant` y los triggers de siempre (DNI vacío → NULL, guard de categoría).
-- Guard de rol explícito: todos menos CONTADOR (solo lectura en Clientes) y VIEWER (Lector, solo lectura en toda la
-- app). La pantalla oculta "Importar" a los dos.
-- El tenant sale de la sesión; la sucursal de los clientes nuevos se valida contra el tenant.
--
-- Payload: p_filas = [{ "fila": 12, "accion": "crear"|"actualizar", "id": "<uuid, solo al actualizar>", "campos": {...} }]
-- Escritura por CONJUNTO (una sentencia por acción+columnas): por fila no entra en los 8 s del rol `authenticated`.

CREATE OR REPLACE FUNCTION public.fn_importar_clientes(p_filas jsonb, p_sucursal_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  c_permitidas CONSTANT text[] := ARRAY['nombre', 'dni', 'telefono', 'email', 'notas', 'etiquetas'];
  v_tenant     uuid := public.get_user_tenant_id();
  v_rol        text;
  v_item       jsonb;
  v_norm       jsonb[] := '{}';
  v_fila       int;
  v_accion     text;
  v_id         uuid;
  v_campos     jsonb;
  v_cols       text[];
  v_extra      text[];
  v_grupo      record;
  v_sql        text;
  v_n          int;
  v_creados    int := 0;
  v_actualiz   int := 0;
  v_constraint text;
  v_vistos     jsonb := '{}';   -- cliente → fila del archivo (dos filas no pueden actualizar al mismo)
  v_k          text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol INTO v_rol FROM public.users WHERE id = auth.uid();
  IF v_rol IS NULL OR v_rol IN ('CONTADOR', 'VIEWER') THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede importar clientes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = p_sucursal_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
  END IF;
  IF jsonb_typeof(p_filas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato inválido: se esperaba una lista de filas.';
  END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'El archivo tiene % filas; el máximo por importación es 5000. Dividilo en partes.', jsonb_array_length(p_filas);
  END IF;

  BEGIN
    -- 1) Validar y normalizar, sin escribir nada.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
      v_fila   := CASE WHEN v_item->>'fila' ~ '^\d{1,9}$' THEN (v_item->>'fila')::int END;
      v_accion := v_item->>'accion';
      v_campos := coalesce(v_item->'campos', '{}'::jsonb);
      v_id     := NULL;

      IF jsonb_typeof(v_campos) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'formato de campos inválido'; END IF;
      IF v_accion IS NULL OR v_accion NOT IN ('crear', 'actualizar') THEN
        RAISE EXCEPTION 'acción inválida "%"', coalesce(v_accion, '');
      END IF;
      SELECT array_agg(k ORDER BY k) INTO v_cols FROM jsonb_object_keys(v_campos) k;
      SELECT array_agg(k) INTO v_extra FROM unnest(coalesce(v_cols, '{}')) k WHERE NOT (k = ANY (c_permitidas));
      IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION 'columna no permitida: %', array_to_string(v_extra, ', ');
      END IF;
      IF v_cols IS NULL THEN RAISE EXCEPTION 'la fila no trae datos'; END IF;
      -- Texto vacío = sin dato (NULL): un email '' chocaría con el índice único de email del negocio.
      FOREACH v_k IN ARRAY ARRAY['dni', 'telefono', 'email', 'notas'] LOOP
        IF v_campos ? v_k AND jsonb_typeof(v_campos->v_k) = 'string' AND btrim(v_campos->>v_k) = '' THEN
          v_campos := jsonb_set(v_campos, ARRAY[v_k], 'null'::jsonb);
        END IF;
      END LOOP;

      IF v_accion = 'crear' THEN
        IF coalesce(trim(v_campos->>'nombre'), '') = '' THEN RAISE EXCEPTION 'falta el nombre'; END IF;
      ELSE
        IF coalesce(v_item->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'falta el cliente a actualizar'; END IF;
        v_id := (v_item->>'id')::uuid;
        IF v_vistos ? v_id::text THEN
          RAISE EXCEPTION 'esta fila y la fila % actualizan al mismo cliente; dejá una sola', v_vistos->>v_id::text;
        END IF;
        v_vistos := v_vistos || jsonb_build_object(v_id::text, v_fila);
        IF v_campos ? 'nombre' AND coalesce(trim(v_campos->>'nombre'), '') = '' THEN
          RAISE EXCEPTION 'el nombre no puede quedar vacío';
        END IF;
      END IF;

      v_norm := v_norm || jsonb_build_object(
        'fila', v_fila, 'accion', v_accion, '_id', v_id, 'campos', v_campos, 'firma', array_to_string(v_cols, ','));
    END LOOP;

    -- 2) Escribir por CONJUNTO: una sentencia por (acción, columnas).
    v_fila := NULL;
    FOR v_grupo IN
      SELECT e->>'accion' AS accion, e->>'firma' AS firma, jsonb_agg(e) AS items
        FROM unnest(v_norm) e
       GROUP BY 1, 2
    LOOP
      IF v_grupo.accion = 'crear' THEN
        v_sql := format(
          $f$WITH ins AS (
               INSERT INTO public.clientes (tenant_id, sucursal_id, %1$s)
               SELECT $1, $3, %2$s
                 FROM jsonb_array_elements($2) e
                 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.clientes, e->'campos') r
               RETURNING id)
             SELECT count(*)::int FROM ins$f$,
          (SELECT string_agg(format('%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k),
          (SELECT string_agg(format('r.%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      ELSE
        v_sql := format(
          $f$WITH upd AS (
               UPDATE public.clientes c SET %1$s
                 FROM (SELECT (e->>'_id')::uuid AS _destino,
                              jsonb_populate_record(NULL::public.clientes, e->'campos') AS x
                         FROM jsonb_array_elements($2) e
                       OFFSET 0) r
                WHERE c.id = r._destino AND c.tenant_id = $1
               RETURNING c.id)
             SELECT count(*)::int FROM upd$f$,
          (SELECT string_agg(format('%1$I = (r.x).%1$I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      END IF;

      BEGIN
        EXECUTE v_sql INTO v_n USING v_tenant, v_grupo.items, p_sucursal_id;
      EXCEPTION WHEN OTHERS THEN
        -- Buscar la fila culpable de a una, solo para el mensaje (igual se deshace todo).
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_grupo.items) LOOP
          v_fila := (v_item->>'fila')::int;
          EXECUTE v_sql USING v_tenant, jsonb_build_array(v_item), p_sucursal_id;
        END LOOP;
        v_fila := NULL;
        RAISE;   -- ninguna falló sola: el problema es entre filas del mismo archivo
      END;

      IF v_n <> jsonb_array_length(v_grupo.items) THEN
        RAISE EXCEPTION 'se procesaron % de % clientes; alguno se borró o es de otro negocio', v_n, jsonb_array_length(v_grupo.items);
      END IF;
      IF v_grupo.accion = 'crear' THEN v_creados := v_creados + v_n; ELSE v_actualiz := v_actualiz + v_n; END IF;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION '%', concat_ws(': ',
        CASE WHEN v_fila IS NOT NULL THEN format('Fila %s', v_fila) END,
        CASE
          WHEN SQLSTATE = '23505' AND v_constraint = 'clientes_dni_tenant'       THEN 'ya existe otro cliente con ese DNI'
          WHEN SQLSTATE = '23505' AND v_constraint = 'idx_clientes_email_unique' THEN 'ya existe otro cliente con ese email'
          WHEN SQLSTATE = '23505' THEN format('dato duplicado (%s)', v_constraint)
          ELSE SQLERRM
        END)
      USING ERRCODE = SQLSTATE;
  END;

  RETURN jsonb_build_object('creados', v_creados, 'actualizados', v_actualiz);
END;
$$;

COMMENT ON FUNCTION public.fn_importar_clientes(jsonb, uuid) IS
  'Importación de clientes todo-o-nada (mig 448, D3-a). INVOKER: rige clientes_tenant; guard de rol = pantalla.';

REVOKE ALL ON FUNCTION public.fn_importar_clientes(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_clientes(jsonb, uuid) TO authenticated;
