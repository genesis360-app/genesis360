-- 452 — Importar el MAESTRO en UNA transacción (todo o nada)
--
-- Backlog "estandarizar importar" (GO 2026-10-01): /configuracion/importar pasa al mismo flujo que Productos,
-- Clientes, Inventario y Proveedores (migs 447-450, D3-a): vista previa completa → botón aparte → TODO O NADA.
-- El importador anterior insertaba fila por fila desde el navegador y tenía silencios:
--   · combos: se creaban SIN `combo_items` → el POS (que arma los combos desde combo_items) los ignoraba;
--   · motivos: la plantilla traía tipo `egreso` y el CHECK solo acepta `rebaje` → la fila fallaba;
--   · ubicaciones: se creaban sin sucursal;
--   · perfiles de vencimiento / grupos: un estado inexistente se salteaba sin avisar; a un perfil existente se le
--     agregaban reglas duplicadas; en grupos se desmarcaba el predeterminado ANTES de crear el nuevo.
-- Tipos: categorias, ubicaciones, estados, motivos, combos, aging (perfiles de vencimiento), grupos.
-- (Proveedores se importa desde /proveedores/importar, mig 450.)
--
-- SECURITY INVOKER: rigen las policies de cada tabla (estados/motivos/ubicaciones: DUEÑO/ADMIN/SUPER_USUARIO;
-- combos: módulo comercial editable). Se excluye VIEWER. El tenant sale de la sesión.
-- Solo CREA: si un nombre ya existe la función lo rechaza (la vista previa ya los deja afuera; esto cubre una carrera).
--
-- Payload (p_filas), según p_tipo:
--   categorias  { fila, nombre, descripcion }
--   ubicaciones { fila, nombre, codigo, descripcion }            (p_sucursal_id = destino; NULL = todas)
--   estados     { fila, nombre, color }
--   motivos     { fila, nombre, tipo }
--   combos      { fila, nombre, descuento_tipo, descuento_valor, vigencia_desde, vigencia_hasta,
--                 items: [{ fila, producto_id, cantidad }] }     (p_sucursal_id = sucursal del combo; NULL = todas)
--   aging       { fila, nombre, reglas: [{ fila, estado_id, dias }] }
--   grupos      { fila, nombre, descripcion, es_default, estados: [estado_id] }

CREATE OR REPLACE FUNCTION public.fn_importar_maestro(p_tipo text, p_filas jsonb, p_sucursal_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_rol        text;
  v_item       jsonb;
  v_sub        jsonb;
  v_fila       int;
  v_nombre     text;
  v_txt        text;
  v_id         uuid;
  v_ref        uuid;
  v_num        numeric;
  v_n          int;
  v_desde      date;
  v_hasta      date;
  v_vistos     text[] := '{}';
  v_defaults   int := 0;
  v_creados    int := 0;
  v_constraint text;
  v_tabla      text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol INTO v_rol FROM public.users WHERE id = auth.uid();
  IF v_rol IS NULL OR v_rol = 'VIEWER' THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede importar datos maestros.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_tabla := CASE p_tipo
    WHEN 'categorias'  THEN 'categorias'
    WHEN 'ubicaciones' THEN 'ubicaciones'
    WHEN 'estados'     THEN 'estados_inventario'
    WHEN 'motivos'     THEN 'motivos_movimiento'
    WHEN 'combos'      THEN 'combos'
    WHEN 'aging'       THEN 'aging_profiles'
    WHEN 'grupos'      THEN 'grupos_estados'
  END;
  IF v_tabla IS NULL THEN RAISE EXCEPTION 'Tipo de importación inválido "%".', coalesce(p_tipo, ''); END IF;
  IF jsonb_typeof(p_filas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato inválido: se esperaba una lista de filas.';
  END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'El archivo tiene % filas; el máximo por importación es 5000. Dividilo en partes.', jsonb_array_length(p_filas);
  END IF;
  -- La sucursal tiene que ser del negocio (RLS de sucursales la acota al tenant).
  IF p_sucursal_id IS NOT NULL AND p_tipo IN ('ubicaciones', 'combos')
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = p_sucursal_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'La sucursal elegida no existe en tu negocio.';
  END IF;

  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'formato de fila inválido'; END IF;
      v_fila   := CASE WHEN v_item->>'fila' ~ '^\d{1,9}$' THEN (v_item->>'fila')::int END;
      v_nombre := nullif(btrim(coalesce(v_item->>'nombre', '')), '');
      IF v_nombre IS NULL THEN RAISE EXCEPTION 'falta el nombre'; END IF;

      -- Nombre repetido en el archivo o ya existente (sin distinguir mayúsculas ni espacios de más).
      v_txt := lower(regexp_replace(v_nombre, '\s+', ' ', 'g'));
      IF v_txt = ANY (v_vistos) THEN RAISE EXCEPTION '"%" está repetido en el archivo', v_nombre; END IF;
      v_vistos := v_vistos || v_txt;
      EXECUTE format(
        'SELECT count(*)::int FROM public.%I WHERE tenant_id = $1 AND lower(regexp_replace(btrim(nombre), ''\s+'', '' '', ''g'')) = $2 %s',
        v_tabla,
        CASE p_tipo
          WHEN 'ubicaciones' THEN 'AND sucursal_id IS NOT DISTINCT FROM $3'
          WHEN 'combos'      THEN 'AND activo IS NOT FALSE'
          ELSE '' END)
        INTO v_n USING v_tenant, v_txt, p_sucursal_id;
      IF v_n > 0 THEN RAISE EXCEPTION '"%" ya existe', v_nombre; END IF;

      IF p_tipo = 'categorias' THEN
        INSERT INTO public.categorias (tenant_id, nombre, descripcion)
        VALUES (v_tenant, v_nombre, nullif(btrim(coalesce(v_item->>'descripcion', '')), ''));

      ELSIF p_tipo = 'ubicaciones' THEN
        v_txt := nullif(upper(btrim(coalesce(v_item->>'codigo', ''))), '');
        IF v_txt IS NOT NULL AND v_txt !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
          RAISE EXCEPTION 'código "%" inválido (letras y números separados por guiones)', v_txt;
        END IF;
        INSERT INTO public.ubicaciones (tenant_id, nombre, codigo, descripcion, sucursal_id)
        VALUES (v_tenant, v_nombre, v_txt, nullif(btrim(coalesce(v_item->>'descripcion', '')), ''), p_sucursal_id);

      ELSIF p_tipo = 'estados' THEN
        v_txt := nullif(btrim(coalesce(v_item->>'color', '')), '');
        IF v_txt IS NOT NULL AND v_txt !~* '^#[0-9a-f]{6}$' THEN
          RAISE EXCEPTION 'color "%" inválido (código hex como #22c55e)', v_txt;
        END IF;
        INSERT INTO public.estados_inventario (tenant_id, nombre, color)
        VALUES (v_tenant, v_nombre, coalesce(lower(v_txt), '#6B7280'));

      ELSIF p_tipo = 'motivos' THEN
        v_txt := coalesce(nullif(lower(btrim(coalesce(v_item->>'tipo', ''))), ''), 'ambos');
        IF v_txt = 'egreso' THEN v_txt := 'rebaje'; END IF;
        IF v_txt NOT IN ('ambos', 'ingreso', 'rebaje', 'caja') THEN
          RAISE EXCEPTION 'tipo "%" inválido (ambos, ingreso, rebaje o caja)', v_txt;
        END IF;
        INSERT INTO public.motivos_movimiento (tenant_id, nombre, tipo) VALUES (v_tenant, v_nombre, v_txt);

      ELSIF p_tipo = 'combos' THEN
        v_txt := lower(coalesce(v_item->>'descuento_tipo', ''));
        IF v_txt NOT IN ('pct', 'monto_ars', 'monto_usd') THEN
          RAISE EXCEPTION 'descuento_tipo "%" inválido (pct, monto_ars o monto_usd)', v_txt;
        END IF;
        IF coalesce(v_item->>'descuento_valor', '') !~ '^\d+(\.\d+)?$' THEN
          RAISE EXCEPTION 'descuento_valor inválido';
        END IF;
        v_num := (v_item->>'descuento_valor')::numeric;
        IF v_txt = 'pct' AND v_num > 100 THEN RAISE EXCEPTION 'el descuento en porcentaje no puede superar 100'; END IF;
        v_desde := CASE WHEN coalesce(v_item->>'vigencia_desde', '') <> '' THEN (v_item->>'vigencia_desde')::date END;
        v_hasta := CASE WHEN coalesce(v_item->>'vigencia_hasta', '') <> '' THEN (v_item->>'vigencia_hasta')::date END;
        IF v_desde > v_hasta THEN RAISE EXCEPTION 'vigencia_desde es posterior a vigencia_hasta'; END IF;
        IF jsonb_typeof(v_item->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'items') = 0 THEN
          RAISE EXCEPTION 'el combo no tiene productos';
        END IF;

        v_id := gen_random_uuid();
        INSERT INTO public.combos (id, tenant_id, nombre, descuento_tipo, descuento_pct, descuento_monto, sucursal_id,
                                   vigencia_desde, vigencia_hasta, activo)
        VALUES (v_id, v_tenant, v_nombre, v_txt,
                CASE WHEN v_txt = 'pct' THEN v_num ELSE 0 END,
                CASE WHEN v_txt <> 'pct' THEN v_num ELSE 0 END,
                p_sucursal_id, v_desde, v_hasta, true);

        FOR v_sub IN SELECT * FROM jsonb_array_elements(v_item->'items') LOOP
          v_fila := CASE WHEN v_sub->>'fila' ~ '^\d{1,9}$' THEN (v_sub->>'fila')::int ELSE v_fila END;
          IF coalesce(v_sub->>'cantidad', '') !~ '^\d{1,6}$' OR (v_sub->>'cantidad')::int < 1 THEN
            RAISE EXCEPTION 'cantidad inválida (entero de 1 en adelante)';
          END IF;
          IF coalesce(v_sub->>'producto_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'producto inválido'; END IF;
          v_ref := (v_sub->>'producto_id')::uuid;
          IF NOT EXISTS (SELECT 1 FROM public.productos WHERE id = v_ref AND tenant_id = v_tenant AND activo IS NOT FALSE) THEN
            RAISE EXCEPTION 'el producto no existe o está desactivado';
          END IF;
          IF EXISTS (SELECT 1 FROM public.combo_items WHERE combo_id = v_id AND producto_id = v_ref) THEN
            RAISE EXCEPTION 'el producto está dos veces en el combo';
          END IF;
          INSERT INTO public.combo_items (tenant_id, combo_id, producto_id, cantidad)
          VALUES (v_tenant, v_id, v_ref, (v_sub->>'cantidad')::int);
        END LOOP;
        IF jsonb_array_length(v_item->'items') = 1 AND (v_item->'items'->0->>'cantidad')::int < 2 THEN
          RAISE EXCEPTION 'un combo de un solo producto necesita cantidad 2 o más';
        END IF;

      ELSIF p_tipo = 'aging' THEN
        IF jsonb_typeof(v_item->'reglas') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'reglas') = 0 THEN
          RAISE EXCEPTION 'el perfil no tiene reglas';
        END IF;
        v_id := gen_random_uuid();
        INSERT INTO public.aging_profiles (id, tenant_id, nombre) VALUES (v_id, v_tenant, v_nombre);
        FOR v_sub IN SELECT * FROM jsonb_array_elements(v_item->'reglas') LOOP
          v_fila := CASE WHEN v_sub->>'fila' ~ '^\d{1,9}$' THEN (v_sub->>'fila')::int ELSE v_fila END;
          IF coalesce(v_sub->>'dias', '') !~ '^\d{1,6}$' THEN RAISE EXCEPTION 'días inválidos (entero de 0 en adelante)'; END IF;
          IF coalesce(v_sub->>'estado_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'estado inválido'; END IF;
          v_ref := (v_sub->>'estado_id')::uuid;
          IF NOT EXISTS (SELECT 1 FROM public.estados_inventario WHERE id = v_ref AND tenant_id = v_tenant AND activo IS NOT FALSE) THEN
            RAISE EXCEPTION 'el estado no existe o está desactivado';
          END IF;
          IF EXISTS (SELECT 1 FROM public.aging_profile_reglas WHERE profile_id = v_id
                       AND (estado_id = v_ref OR dias = (v_sub->>'dias')::int)) THEN
            RAISE EXCEPTION 'el perfil ya tiene una regla con ese estado o con esos días';
          END IF;
          INSERT INTO public.aging_profile_reglas (tenant_id, profile_id, estado_id, dias)
          VALUES (v_tenant, v_id, v_ref, (v_sub->>'dias')::int);
        END LOOP;

      ELSIF p_tipo = 'grupos' THEN
        IF jsonb_typeof(v_item->'estados') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'estados') = 0 THEN
          RAISE EXCEPTION 'el grupo no tiene estados';
        END IF;
        IF coalesce((v_item->>'es_default')::boolean, false) THEN
          v_defaults := v_defaults + 1;
          IF v_defaults > 1 THEN RAISE EXCEPTION 'solo un grupo puede ser el predeterminado'; END IF;
          -- Dentro de la transacción: si algo falla después, el predeterminado anterior vuelve.
          UPDATE public.grupos_estados SET es_default = false WHERE tenant_id = v_tenant AND es_default;
        END IF;
        v_id := gen_random_uuid();
        INSERT INTO public.grupos_estados (id, tenant_id, nombre, descripcion, es_default)
        VALUES (v_id, v_tenant, v_nombre, nullif(btrim(coalesce(v_item->>'descripcion', '')), ''),
                coalesce((v_item->>'es_default')::boolean, false));
        FOR v_sub IN SELECT * FROM jsonb_array_elements(v_item->'estados') LOOP
          IF coalesce(v_sub #>> '{}', '') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'estado inválido'; END IF;
          v_ref := (v_sub #>> '{}')::uuid;
          IF NOT EXISTS (SELECT 1 FROM public.estados_inventario WHERE id = v_ref AND tenant_id = v_tenant AND activo IS NOT FALSE) THEN
            RAISE EXCEPTION 'un estado no existe o está desactivado';
          END IF;
          INSERT INTO public.grupo_estado_items (grupo_id, estado_id) VALUES (v_id, v_ref) ON CONFLICT DO NOTHING;
        END LOOP;
      END IF;

      v_creados := v_creados + 1;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION '%', concat_ws(': ',
        CASE WHEN v_fila IS NOT NULL THEN format('Fila %s', v_fila) END,
        CASE
          WHEN SQLSTATE = '42501' THEN 'tu rol no tiene permiso para crear esto'
          WHEN SQLSTATE = '23505' AND v_constraint = 'uq_ubicaciones_tenant_codigo' THEN 'ese código de ubicación ya existe'
          WHEN SQLSTATE = '23505' THEN format('dato duplicado (%s)', v_constraint)
          WHEN SQLSTATE = '23514' THEN format('dato inválido (%s)', v_constraint)
          WHEN SQLSTATE IN ('22007', '22008') THEN 'fecha inválida'
          ELSE SQLERRM
        END)
      USING ERRCODE = SQLSTATE;
  END;

  RETURN jsonb_build_object('creados', v_creados);
END;
$$;

COMMENT ON FUNCTION public.fn_importar_maestro(text, jsonb, uuid) IS
  'Importación del Maestro todo-o-nada (mig 452, D3-a). INVOKER: rigen las policies de cada tabla. Solo crea.';

REVOKE ALL ON FUNCTION public.fn_importar_maestro(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_maestro(text, jsonb, uuid) TO authenticated;
