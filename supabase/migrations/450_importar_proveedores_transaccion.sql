-- 450 — Importar proveedores en UNA transacción (todo o nada)
--
-- Backlog "estandarizar importar" (GO 2026-10-01): la pantalla de Proveedores no tenía importador (solo el Maestro
-- cargaba nombre/contacto/teléfono/email). Mismo criterio que las migs 447-449 (D3-a): vista previa completa → botón
-- aparte → TODO O NADA, con razón social, CUIT, condición IVA, domicilio, plazo, banco/CBU, etc.
--
-- SECURITY INVOKER: rigen las policies de `proveedores` y el CHECK de condición IVA. Rol: la pantalla no restringe
-- quién da de alta proveedores; se excluye solo VIEWER (Lector, solo lectura). El tenant sale de la sesión.
-- Al actualizar se escriben SOLO las columnas que trae el archivo con valor (una celda vacía no borra nada).
--
-- Payload: p_filas = [{ "fila": 12, "accion": "crear"|"actualizar", "id": "<uuid, solo al actualizar>", "campos": {...} }]
-- Escritura por CONJUNTO (una sentencia por acción+columnas), igual que 447/448.

CREATE OR REPLACE FUNCTION public.fn_importar_proveedores(p_filas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  c_permitidas CONSTANT text[] := ARRAY[
    'tipo', 'nombre', 'razon_social', 'cuit', 'dni', 'condicion_iva', 'domicilio', 'contacto', 'telefono', 'email',
    'plazo_pago_dias', 'banco', 'cbu', 'notas', 'etiquetas'
  ];
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
  v_k          text;
  v_vistos     jsonb := '{}';   -- proveedor → fila del archivo (dos filas no pueden actualizar al mismo)
  v_grupo      record;
  v_sql        text;
  v_n          int;
  v_creados    int := 0;
  v_actualiz   int := 0;
  v_constraint text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol INTO v_rol FROM public.users WHERE id = auth.uid();
  IF v_rol IS NULL OR v_rol = 'VIEWER' THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede importar proveedores.' USING ERRCODE = 'insufficient_privilege';
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
      -- Textos recortados (como el alta manual) y vacío = sin dato (NULL).
      FOREACH v_k IN ARRAY ARRAY['nombre', 'razon_social', 'cuit', 'dni', 'condicion_iva', 'domicilio', 'contacto', 'telefono',
                                 'email', 'banco', 'cbu', 'notas', 'tipo'] LOOP
        IF v_campos ? v_k AND jsonb_typeof(v_campos->v_k) NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'la columna % tiene que ser texto', v_k;
        END IF;
        IF v_campos ? v_k AND jsonb_typeof(v_campos->v_k) = 'string' THEN
          v_campos := jsonb_set(v_campos, ARRAY[v_k],
            CASE WHEN btrim(v_campos->>v_k) = '' THEN 'null'::jsonb ELSE to_jsonb(btrim(v_campos->>v_k)) END);
        END IF;
      END LOOP;
      -- Sin tipo: en un alta toma el default ('proveedor'); al actualizar no se puede dejar sin tipo.
      IF v_campos ? 'tipo' AND jsonb_typeof(v_campos->'tipo') = 'null' THEN
        IF v_accion = 'crear' THEN v_campos := v_campos - 'tipo'; ELSE RAISE EXCEPTION 'el tipo no puede quedar vacío'; END IF;
        SELECT array_agg(k ORDER BY k) INTO v_cols FROM jsonb_object_keys(v_campos) k;
      END IF;
      IF v_campos ? 'cuit' AND jsonb_typeof(v_campos->'cuit') = 'string' AND v_campos->>'cuit' !~ '^\d{11}$' THEN
        RAISE EXCEPTION 'CUIT inválido (11 dígitos)';
      END IF;
      IF v_campos ? 'cbu' AND jsonb_typeof(v_campos->'cbu') = 'string' AND v_campos->>'cbu' !~ '^\d{22}$' THEN
        RAISE EXCEPTION 'CBU inválido (22 dígitos)';
      END IF;
      IF v_campos ? 'plazo_pago_dias' AND jsonb_typeof(v_campos->'plazo_pago_dias') <> 'null'
         AND (v_campos->>'plazo_pago_dias' !~ '^\d{1,3}$') THEN
        RAISE EXCEPTION 'plazo de pago inválido (días enteros)';
      END IF;

      IF v_accion = 'crear' THEN
        IF coalesce(trim(v_campos->>'nombre'), '') = '' THEN RAISE EXCEPTION 'falta el nombre'; END IF;
      ELSE
        IF coalesce(v_item->>'id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
          RAISE EXCEPTION 'falta el proveedor a actualizar';
        END IF;
        v_id := (v_item->>'id')::uuid;
        IF v_vistos ? v_id::text THEN
          RAISE EXCEPTION 'esta fila y la fila % actualizan al mismo proveedor; dejá una sola', v_vistos->>v_id::text;
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
               INSERT INTO public.proveedores (tenant_id, %1$s)
               SELECT $1, %2$s
                 FROM jsonb_array_elements($2) e
                 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.proveedores, e->'campos') r
               RETURNING id)
             SELECT count(*)::int FROM ins$f$,
          (SELECT string_agg(format('%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k),
          (SELECT string_agg(format('r.%I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      ELSE
        v_sql := format(
          $f$WITH upd AS (
               UPDATE public.proveedores p SET %1$s
                 FROM (SELECT (e->>'_id')::uuid AS _destino,
                              jsonb_populate_record(NULL::public.proveedores, e->'campos') AS x
                         FROM jsonb_array_elements($2) e
                       OFFSET 0) r
                WHERE p.id = r._destino AND p.tenant_id = $1
               RETURNING p.id)
             SELECT count(*)::int FROM upd$f$,
          (SELECT string_agg(format('%1$I = (r.x).%1$I', k), ', ') FROM unnest(string_to_array(v_grupo.firma, ',')) k));
      END IF;

      BEGIN
        EXECUTE v_sql INTO v_n USING v_tenant, v_grupo.items;
      EXCEPTION WHEN OTHERS THEN
        -- Buscar la fila culpable de a una, solo para el mensaje (igual se deshace todo).
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_grupo.items) LOOP
          v_fila := (v_item->>'fila')::int;
          EXECUTE v_sql USING v_tenant, jsonb_build_array(v_item);
        END LOOP;
        v_fila := NULL;
        RAISE;
      END;

      IF v_n <> jsonb_array_length(v_grupo.items) THEN
        RAISE EXCEPTION 'se procesaron % de % proveedores; alguno se borró o es de otro negocio', v_n, jsonb_array_length(v_grupo.items);
      END IF;
      IF v_grupo.accion = 'crear' THEN v_creados := v_creados + v_n; ELSE v_actualiz := v_actualiz + v_n; END IF;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION '%', concat_ws(': ',
        CASE WHEN v_fila IS NOT NULL THEN format('Fila %s', v_fila) END,
        CASE
          WHEN SQLSTATE = '23514' AND v_constraint = 'proveedores_condicion_iva_check' THEN 'condición IVA inválida'
          WHEN SQLSTATE = '23514' AND v_constraint = 'proveedores_tipo_check' THEN 'tipo inválido (proveedor o servicio)'
          WHEN SQLSTATE = '23505' THEN format('dato duplicado (%s)', v_constraint)
          ELSE SQLERRM
        END)
      USING ERRCODE = SQLSTATE;
  END;

  RETURN jsonb_build_object('creados', v_creados, 'actualizados', v_actualiz);
END;
$$;

COMMENT ON FUNCTION public.fn_importar_proveedores(jsonb) IS
  'Importación de proveedores todo-o-nada (mig 450, D3-a). INVOKER: rigen las policies y el CHECK de condición IVA.';

REVOKE ALL ON FUNCTION public.fn_importar_proveedores(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_proveedores(jsonb) TO authenticated;
