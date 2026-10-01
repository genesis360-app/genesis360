-- 449 — Importar inventario (ingreso de stock) en UNA transacción (todo o nada)
--
-- Decisión D3-a de Fede/GO (vista previa → botón aparte → todo o nada), aplicada al importador de stock. Además del
-- "a medias", el importador viejo (src/pages/ImportarInventarioPage.tsx, escribía desde el navegador) se apartaba del
-- ingreso normal de la app (InventarioPage → ingreso / ingreso masivo) en cosas de REGLA #0:
--   · no guardaba la SUCURSAL de la línea ni del movimiento;
--   · una ubicación/estado/proveedor mal escrito se ignoraba en silencio (el stock entraba sin ese dato);
--   · truncaba decimales en silencio (parseInt: 1,5 → 1);
--   · no exigía lote / vencimiento / atributos (talle, color…) cuando el producto los requiere;
--   · si el movimiento fallaba, la línea quedaba sin su asiento en el historial (error ignorado);
--   · no respetaba el conteo wall-to-wall en curso, que bloquea mover stock en la sucursal;
--   · en productos con series ponía la cantidad en la línea (el ingreso normal pone 0; el stock sale de las series).
-- En PROD nunca se usó (0 líneas `IMP-%` al 2026-10-01): no hay datos que corregir.
--
-- Esta función hace lo mismo que el ingreso normal, validado en el servidor: línea + series + movimiento `ingreso`
-- con stock antes/después POR SUCURSAL (las filas del mismo producto se encadenan en el orden del archivo).
-- SECURITY INVOKER: rigen RLS y los triggers de stock (recalcular_stock, sync ML/TN). Rol: todos los que hoy pueden
-- ingresar stock; se excluye solo VIEWER (Lector, solo lectura). La sucursal es OBLIGATORIA, como en el ingreso normal.
--
-- Payload: p_filas = [{ "fila": 12, "producto_id": "...", "cantidad": 10 | null, "series": ["SN1", …] | null,
--   "ubicacion_id", "estado_id", "proveedor_id", "nro_lote", "fecha_vencimiento": "AAAA-MM-DD", "lpn", "motivo",
--   "precio_costo", "talle", "color", "encaje", "formato", "sabor_aroma" }]

CREATE OR REPLACE FUNCTION public.fn_importar_inventario(p_filas jsonb, p_sucursal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant     uuid := public.get_user_tenant_id();
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_item       jsonb;
  v_norm       jsonb[] := '{}';
  v_fila       int;
  v_p          record;
  v_cant       int;
  v_series     text[];
  v_fecha      date;
  v_attr       text;
  v_req        boolean;
  v_vistas     jsonb := '{}';   -- "producto|serie" → fila (serie repetida dentro del archivo)
  v_s          text;
  v_lineas     int := 0;
  v_unidades   numeric := 0;
  v_constraint text;
  v_uuid_re    CONSTANT text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_lpn        text;
  v_lpns       jsonb := '{}';   -- LPN → fila (repetido dentro del archivo)
  v_mono       jsonb := '{}';   -- ubicación mono-SKU → producto del archivo
  v_ubic       record;
  v_otro       text;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol INTO v_rol FROM public.users WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol = 'VIEWER' THEN
    RAISE EXCEPTION 'No autorizado: tu rol no puede ingresar stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sucursal_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = p_sucursal_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Elegí la sucursal de destino del ingreso.';
  END IF;
  -- Un usuario restringido a su sucursal solo ingresa ahí (RLS lo frenaría igual, con un error ilegible).
  IF NOT public.auth_ve_todas_sucursales() AND public.auth_user_sucursal() IS DISTINCT FROM p_sucursal_id THEN
    RAISE EXCEPTION 'No podés ingresar stock en esa sucursal.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Conteos 2.0 · A2: igual que el ingreso normal, no se mueve stock durante un conteo wall-to-wall.
  IF EXISTS (SELECT 1 FROM public.inventario_conteos
              WHERE tenant_id = v_tenant AND sucursal_id = p_sucursal_id
                AND estado = 'borrador' AND bloquea_movimientos = true) THEN
    RAISE EXCEPTION 'Hay un conteo wall-to-wall en curso en esta sucursal. Finalizalo o eliminalo antes de ingresar stock.';
  END IF;
  IF jsonb_typeof(p_filas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato inválido: se esperaba una lista de filas.';
  END IF;
  -- Tope más bajo que productos/clientes: cada línea dispara los triggers de stock (recalcular_stock, alertas, sync
  -- ML/TN), ~1,4 ms por fila en DEV (3000 productos = 4,3 s); el rol `authenticated` corta a los 8 s.
  IF jsonb_array_length(p_filas) > 2000 THEN
    RAISE EXCEPTION 'El archivo tiene % filas; el máximo por importación de stock es 2000. Dividilo en partes.', jsonb_array_length(p_filas);
  END IF;

  BEGIN
    -- 1) Validar TODO antes de escribir nada.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
      v_fila := CASE WHEN v_item->>'fila' ~ '^\d{1,9}$' THEN (v_item->>'fila')::int END;

      SELECT id, nombre, tiene_series, tiene_lote, tiene_vencimiento, tiene_talle, tiene_color, tiene_encaje,
             tiene_formato, tiene_sabor_aroma, precio_costo, precio_venta
        INTO v_p
        FROM public.productos
       WHERE id = CASE WHEN coalesce(v_item->>'producto_id', '') ~ v_uuid_re THEN (v_item->>'producto_id')::uuid END
         AND tenant_id = v_tenant AND activo IS NOT FALSE;
      IF v_p.id IS NULL THEN RAISE EXCEPTION 'el producto no existe o está inactivo'; END IF;

      IF v_p.tiene_series THEN
        SELECT array_agg(btrim(x)) INTO v_series
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_item->'series') = 'array' THEN v_item->'series' ELSE '[]' END) x
         WHERE btrim(x) <> '';
        IF v_series IS NULL THEN RAISE EXCEPTION 'producto con series: completá numeros_serie'; END IF;
        FOREACH v_s IN ARRAY v_series LOOP
          IF v_vistas ? (v_p.id::text || '|' || v_s) THEN
            RAISE EXCEPTION 'la serie % ya aparece en la fila %', v_s, v_vistas->>(v_p.id::text || '|' || v_s);
          END IF;
          v_vistas := v_vistas || jsonb_build_object(v_p.id::text || '|' || v_s, v_fila);
        END LOOP;
        v_cant := coalesce(array_length(v_series, 1), 0);
      ELSE
        v_series := NULL;
        IF coalesce(v_item->>'cantidad', '') !~ '^\d{1,9}$' OR (v_item->>'cantidad')::int <= 0 THEN
          RAISE EXCEPTION 'la cantidad tiene que ser un número entero mayor a 0';
        END IF;
        v_cant := (v_item->>'cantidad')::int;
      END IF;

      IF v_p.tiene_lote AND coalesce(btrim(v_item->>'nro_lote'), '') = '' THEN RAISE EXCEPTION 'el producto requiere lote'; END IF;
      v_fecha := NULL;
      IF coalesce(v_item->>'fecha_vencimiento', '') <> '' THEN
        IF v_item->>'fecha_vencimiento' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'fecha de vencimiento inválida (usá AAAA-MM-DD)'; END IF;
        BEGIN
          v_fecha := (v_item->>'fecha_vencimiento')::date;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'fecha de vencimiento inválida (usá AAAA-MM-DD)';
        END;
      END IF;
      IF v_p.tiene_vencimiento AND v_fecha IS NULL THEN RAISE EXCEPTION 'el producto requiere fecha de vencimiento'; END IF;
      FOREACH v_attr IN ARRAY ARRAY['talle', 'color', 'encaje', 'formato', 'sabor_aroma'] LOOP
        -- (en una variable: dentro de un IF, el THEN del CASE cortaría la condición)
        v_req := CASE v_attr WHEN 'talle' THEN v_p.tiene_talle WHEN 'color' THEN v_p.tiene_color
                             WHEN 'encaje' THEN v_p.tiene_encaje WHEN 'formato' THEN v_p.tiene_formato
                             ELSE v_p.tiene_sabor_aroma END;
        IF coalesce(v_req, false) AND coalesce(btrim(v_item->>v_attr), '') = '' THEN
          RAISE EXCEPTION 'el producto requiere %', replace(v_attr, '_', '/');
        END IF;
      END LOOP;

      -- Referencias: del negocio, activas; la ubicación además de ESTA sucursal (o global).
      IF (coalesce(v_item->>'ubicacion_id', '') <> '' AND v_item->>'ubicacion_id' !~ v_uuid_re)
         OR (coalesce(v_item->>'estado_id', '') <> '' AND v_item->>'estado_id' !~ v_uuid_re)
         OR (coalesce(v_item->>'proveedor_id', '') <> '' AND v_item->>'proveedor_id' !~ v_uuid_re) THEN
        RAISE EXCEPTION 'referencia inválida (ubicación, estado o proveedor)';
      END IF;
      IF coalesce(v_item->>'ubicacion_id', '') <> '' THEN
        SELECT id, nombre, coalesce(mono_sku, false) AS mono INTO v_ubic
          FROM public.ubicaciones WHERE id = (v_item->>'ubicacion_id')::uuid AND tenant_id = v_tenant
           AND activo IS NOT FALSE AND (sucursal_id IS NULL OR sucursal_id = p_sucursal_id);
        IF v_ubic.id IS NULL THEN RAISE EXCEPTION 'la ubicación no existe en esta sucursal o está desactivada'; END IF;
        -- I-05 (igual que el ingreso individual): una ubicación Mono-SKU no admite un segundo producto con stock, ni
        -- de la base ni de otra fila del archivo.
        IF v_ubic.mono THEN
          v_otro := NULL;
          SELECT pr.nombre INTO v_otro
            FROM public.inventario_lineas l JOIN public.productos pr ON pr.id = l.producto_id
           WHERE l.tenant_id = v_tenant AND l.ubicacion_id = v_ubic.id AND l.activo AND l.cantidad > 0
             AND l.producto_id <> v_p.id
           LIMIT 1;
          IF v_otro IS NOT NULL THEN
            RAISE EXCEPTION 'la ubicación "%" es Mono-SKU y ya tiene "%"', v_ubic.nombre, v_otro;
          END IF;
          IF v_mono ? v_ubic.id::text AND v_mono->>v_ubic.id::text <> v_p.id::text THEN
            RAISE EXCEPTION 'la ubicación "%" es Mono-SKU y otra fila del archivo le pone otro producto', v_ubic.nombre;
          END IF;
          v_mono := v_mono || jsonb_build_object(v_ubic.id::text, v_p.id);
        END IF;
      END IF;
      -- LPN: único entre los activos del negocio (igual que el ingreso individual) y dentro del archivo.
      v_lpn := nullif(btrim(v_item->>'lpn'), '');
      IF v_lpn IS NOT NULL THEN
        IF v_lpns ? v_lpn THEN RAISE EXCEPTION 'el LPN "%" ya aparece en la fila %', v_lpn, v_lpns->>v_lpn; END IF;
        v_lpns := v_lpns || jsonb_build_object(v_lpn, v_fila);
        v_otro := NULL;
        SELECT pr.nombre INTO v_otro
          FROM public.inventario_lineas l JOIN public.productos pr ON pr.id = l.producto_id
         WHERE l.tenant_id = v_tenant AND l.lpn = v_lpn AND l.activo
         LIMIT 1;
        IF FOUND THEN RAISE EXCEPTION 'el LPN "%" ya existe en %', v_lpn, coalesce(v_otro, 'otro producto'); END IF;
      END IF;
      IF coalesce(v_item->>'estado_id', '') <> '' AND NOT EXISTS (
           SELECT 1 FROM public.estados_inventario WHERE id = (v_item->>'estado_id')::uuid AND tenant_id = v_tenant AND activo IS NOT FALSE) THEN
        RAISE EXCEPTION 'el estado de inventario no existe o está desactivado';
      END IF;
      IF coalesce(v_item->>'proveedor_id', '') <> '' AND NOT EXISTS (
           SELECT 1 FROM public.proveedores WHERE id = (v_item->>'proveedor_id')::uuid AND tenant_id = v_tenant AND activo IS NOT FALSE) THEN
        RAISE EXCEPTION 'el proveedor no existe o está desactivado';
      END IF;
      IF coalesce(v_item->>'precio_costo', '') <> '' AND (v_item->>'precio_costo') !~ '^\d+(\.\d+)?$' THEN
        RAISE EXCEPTION 'precio de costo inválido';
      END IF;

      v_norm := v_norm || jsonb_build_object(
        'ord', coalesce(array_length(v_norm, 1), 0) + 1, 'fila', v_fila, 'linea', gen_random_uuid(),
        'producto_id', v_p.id, 'series', to_jsonb(v_series), 'mov_cant', v_cant,
        'linea_cant', CASE WHEN v_p.tiene_series THEN 0 ELSE v_cant END,
        'ubicacion_id', nullif(v_item->>'ubicacion_id', ''), 'estado_id', nullif(v_item->>'estado_id', ''),
        'proveedor_id', nullif(v_item->>'proveedor_id', ''),
        'nro_lote', nullif(btrim(v_item->>'nro_lote'), ''), 'fecha_vencimiento', v_fecha,
        'lpn', v_lpn, 'motivo', coalesce(nullif(btrim(v_item->>'motivo'), ''), 'Carga masiva'),
        'costo', coalesce(nullif(v_item->>'precio_costo', '')::numeric, v_p.precio_costo), 'venta', v_p.precio_venta,
        'talle', CASE WHEN v_p.tiene_talle THEN nullif(btrim(v_item->>'talle'), '') END,
        'color', CASE WHEN v_p.tiene_color THEN nullif(btrim(v_item->>'color'), '') END,
        'encaje', CASE WHEN v_p.tiene_encaje THEN nullif(btrim(v_item->>'encaje'), '') END,
        'formato', CASE WHEN v_p.tiene_formato THEN nullif(btrim(v_item->>'formato'), '') END,
        'sabor_aroma', CASE WHEN v_p.tiene_sabor_aroma THEN nullif(btrim(v_item->>'sabor_aroma'), '') END);
    END LOOP;
    v_fila := NULL;

    -- Series que ya existen en el negocio (la clave única es tenant + producto + serie, aunque esté vendida).
    SELECT (e->>'fila')::int, s INTO v_fila, v_s
      FROM unnest(v_norm) e
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e->'series') = 'array' THEN e->'series' ELSE '[]'::jsonb END) s
      JOIN public.inventario_series i ON i.tenant_id = v_tenant AND i.producto_id = (e->>'producto_id')::uuid AND i.nro_serie = s
     LIMIT 1;
    IF v_fila IS NOT NULL THEN
      RAISE EXCEPTION 'la serie % ya está cargada para ese producto', v_s;
    END IF;

    -- 2) Movimientos con stock antes/después POR SUCURSAL: base de la sucursal ANTES de esta carga + lo que suman las
    --    filas anteriores del mismo producto en el archivo. Se calcula en el array antes de insertar nada.
    SELECT coalesce(array_agg(x ORDER BY (x->>'ord')::int), '{}') INTO v_norm
      FROM (
        SELECT e || jsonb_build_object('antes',
                 b.base + coalesce(sum((e->>'mov_cant')::int) OVER (PARTITION BY e->>'producto_id' ORDER BY (e->>'ord')::int
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)) AS x
          FROM unnest(v_norm) e
          JOIN LATERAL (
            SELECT CASE WHEN p.tiene_series
                        THEN (SELECT count(*) FROM public.inventario_series s JOIN public.inventario_lineas l ON l.id = s.linea_id
                               WHERE s.producto_id = p.id AND s.activo AND l.activo AND l.sucursal_id = p_sucursal_id)
                        ELSE (SELECT coalesce(sum(l.cantidad), 0) FROM public.inventario_lineas l
                               WHERE l.producto_id = p.id AND l.activo AND l.sucursal_id = p_sucursal_id)
                   END::int AS base
              FROM public.productos p WHERE p.id = (e->>'producto_id')::uuid) b ON true
      ) t;

    -- 3) Líneas, series y movimientos, por conjunto.
    INSERT INTO public.inventario_lineas (id, tenant_id, producto_id, lpn, cantidad, estado_id, ubicacion_id, proveedor_id,
      nro_lote, fecha_vencimiento, precio_costo_snapshot, precio_venta_snapshot, sucursal_id,
      talle, color, encaje, formato, sabor_aroma)
    SELECT (e->>'linea')::uuid, v_tenant, (e->>'producto_id')::uuid, e->>'lpn', (e->>'linea_cant')::int,
           (e->>'estado_id')::uuid, (e->>'ubicacion_id')::uuid, (e->>'proveedor_id')::uuid,
           e->>'nro_lote', (e->>'fecha_vencimiento')::date, (e->>'costo')::numeric, (e->>'venta')::numeric, p_sucursal_id,
           e->>'talle', e->>'color', e->>'encaje', e->>'formato', e->>'sabor_aroma'
      FROM unnest(v_norm) e;

    INSERT INTO public.inventario_series (tenant_id, producto_id, linea_id, nro_serie, estado_id, reservado, activo)
    SELECT v_tenant, (e->>'producto_id')::uuid, (e->>'linea')::uuid, s, (e->>'estado_id')::uuid, false, true
      FROM unnest(v_norm) e
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(e->'series') = 'array' THEN e->'series' ELSE '[]'::jsonb END) s;

    INSERT INTO public.movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo,
      estado_id, proveedor_id, usuario_id, linea_id, sucursal_id)
    SELECT v_tenant, (e->>'producto_id')::uuid, 'ingreso', (e->>'mov_cant')::int, (e->>'antes')::int,
           (e->>'antes')::int + (e->>'mov_cant')::int, e->>'motivo',
           (e->>'estado_id')::uuid, (e->>'proveedor_id')::uuid, v_uid, (e->>'linea')::uuid, p_sucursal_id
      FROM unnest(v_norm) e;

    SELECT count(*), coalesce(sum((e->>'mov_cant')::int), 0) INTO v_lineas, v_unidades FROM unnest(v_norm) e;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION '%', concat_ws(': ',
        CASE WHEN v_fila IS NOT NULL THEN format('Fila %s', v_fila) END,
        CASE
          WHEN SQLSTATE = '23505' AND v_constraint ILIKE '%nro_serie%' THEN 'hay una serie que ya está cargada'
          WHEN SQLSTATE = '23505' THEN format('dato duplicado (%s)', v_constraint)
          ELSE SQLERRM
        END)
      USING ERRCODE = SQLSTATE;
  END;

  RETURN jsonb_build_object('lineas', v_lineas, 'unidades', v_unidades);
END;
$$;

COMMENT ON FUNCTION public.fn_importar_inventario(jsonb, uuid) IS
  'Ingreso masivo de stock desde archivo, todo-o-nada (mig 449, D3-a). Mismo resultado que el ingreso normal: línea + series + movimiento por sucursal.';

REVOKE ALL ON FUNCTION public.fn_importar_inventario(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_inventario(jsonb, uuid) TO authenticated;
