-- ============================================================
-- 313_reasignar_stock_serializado.sql
-- Cierra el último pendiente del rediseño UoM: reasignar stock de productos SERIALIZADOS.
--
-- 🛑 REGLA #0 (INVENTARIO + TRAZABILIDAD). En un producto con `tiene_series` cada unidad ES un
-- número de serie concreto: decir "6 a Rojo y 4 a Azul" NO alcanza, hay que decir CUÁL serie va a
-- CUÁL variante. Si se reparte a ciegas, el historial de esa unidad física (garantía, RMA, recall)
-- queda apuntando al SKU equivocado. Por eso la mig 309 lo rechazaba y la 312 directamente impedía
-- convertir un serializado con stock en agrupador (el stock quedaba atrapado).
--
-- Acá se resuelve de verdad: cada asignación puede traer la LISTA de series a mover.
--
-- Cómo se guarda el stock serializado (verificado contra datos reales, NO asumido):
--   · `recalcular_stock` cuenta `inventario_series WHERE activo` — **NO** usa `inventario_lineas.cantidad`.
--   · El ingreso crea la línea con `cantidad = 0` y carga las series aparte. En DEV hay un producto
--     con `sum(lineas.cantidad) = 100` y 26 series activas: la `cantidad` de la línea es decorativa
--     para estos productos, la verdad son las series.
--   · `inventario_series` YA tiene trigger `series_recalcular_stock` (AFTER I/U/D) → mover una serie
--     de producto recalcula el stock de AMBOS lados solo.
-- Por eso, para serializados, lo que se mueve son las FILAS DE SERIE, y la línea solo las contiene.
--
-- También se LEVANTA el guard de la mig 312 (ya no hace falta: el callejón sin salida desapareció).
-- ============================================================

-- ── 1) Levantar el guard de la mig 312 ───────────────────────────────────────────────────
-- Vuelve a la versión de la mig 305 (sin el bloqueo de serializado-con-stock), porque ahora ese
-- stock SÍ se puede repartir. El resto de las reglas (mismo tenant, solo 2 niveles) queda igual.
CREATE OR REPLACE FUNCTION public.trg_variante_compose_nombre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_madre_nombre text;
  v_madre_padre  uuid;
  v_madre_tenant uuid;
BEGIN
  IF NEW.producto_padre_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nombre, producto_padre_id, tenant_id
    INTO v_madre_nombre, v_madre_padre, v_madre_tenant
  FROM productos WHERE id = NEW.producto_padre_id;
  IF v_madre_nombre IS NULL THEN
    RAISE EXCEPTION 'La madre % no existe', NEW.producto_padre_id;
  END IF;
  IF v_madre_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'La madre pertenece a otro tenant';
  END IF;
  IF v_madre_padre IS NOT NULL THEN
    RAISE EXCEPTION 'Una variante no puede colgar de otra variante (solo 2 niveles: madre → hijo)';
  END IF;
  IF EXISTS (SELECT 1 FROM productos WHERE producto_padre_id = NEW.id) THEN
    RAISE EXCEPTION 'Este producto ya tiene variantes propias; no puede convertirse en hijo de otro';
  END IF;

  NEW.nombre := v_madre_nombre || ' — ' || NEW.variante_diferenciador;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_variante_compose_nombre() IS
  'Compone el nombre del hijo (madre — diferenciador) y guarda las reglas de variantes: mismo tenant y solo 2 niveles. El guard de "serializado con stock" (mig 312) se levantó en la mig 313, cuando la reasignación pasó a soportar series.';

-- ── 2) Reasignación con soporte de series ────────────────────────────────────────────────
-- p_asignaciones: [{"linea_id":uuid, "hijo_id":uuid, "cantidad":int, "series":[uuid,...]}, ...]
--   · Producto NO serializado → `series` ausente/vacío; manda `cantidad` (igual que la mig 309).
--   · Producto SERIALIZADO    → `series` OBLIGATORIO; la cantidad es el largo de la lista.
CREATE OR REPLACE FUNCTION public.fn_reasignar_stock_variante(
  p_madre_id     uuid,
  p_asignaciones jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant uuid;
  v_madre         RECORD;
  v_linea         RECORD;
  v_chk           RECORD;
  v_asig          RECORD;
  v_hijo          RECORD;
  v_dest_linea    uuid;
  v_madre_antes   int;
  v_madre_desp    int;
  v_hijo_antes    int;
  v_hijo_desp     int;
  v_total_lineas  int := 0;
  v_total_unid    int := 0;
  v_series        uuid[];
  v_n_series      int;
  v_serializado   boolean;
  v_dup           int;
BEGIN
  SELECT tenant_id INTO v_caller_tenant FROM users WHERE id = auth.uid();
  IF v_caller_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant';
  END IF;

  SELECT id, tenant_id, nombre, COALESCE(tiene_series, false) AS tiene_series INTO v_madre
  FROM productos WHERE id = p_madre_id;
  IF v_madre.id IS NULL THEN
    RAISE EXCEPTION 'El producto no existe';
  END IF;
  IF v_madre.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  v_serializado := v_madre.tiene_series;

  IF NOT EXISTS (SELECT 1 FROM productos WHERE producto_padre_id = p_madre_id) THEN
    RAISE EXCEPTION '"%" no tiene variantes: no hay a quién reasignarle el stock', v_madre.nombre;
  END IF;

  IF p_asignaciones IS NULL OR jsonb_typeof(p_asignaciones) <> 'array'
     OR jsonb_array_length(p_asignaciones) = 0 THEN
    RAISE EXCEPTION 'No se recibió ninguna asignación';
  END IF;

  -- ── Serializados: una serie no puede ir a dos variantes a la vez ──────────────────────
  IF v_serializado THEN
    SELECT count(*) INTO v_dup FROM (
      SELECT s.value::text AS sid
      FROM jsonb_array_elements(p_asignaciones) e,
           jsonb_array_elements_text(COALESCE(e->'series','[]'::jsonb)) s
      GROUP BY s.value::text HAVING count(*) > 1
    ) d;
    IF v_dup > 0 THEN
      RAISE EXCEPTION 'Hay números de serie asignados a más de una variante';
    END IF;
  END IF;

  -- ── PASO 1: validar TODO antes de mover nada (y bloquear las líneas) ──────────────────
  FOR v_chk IN
    SELECT a.linea_id, sum(a.cantidad)::int AS total
    FROM (
      SELECT (e->>'linea_id')::uuid AS linea_id,
             CASE WHEN v_serializado
                  THEN jsonb_array_length(COALESCE(e->'series','[]'::jsonb))
                  ELSE (e->>'cantidad')::int END AS cantidad
      FROM jsonb_array_elements(p_asignaciones) e
    ) a
    GROUP BY a.linea_id
    ORDER BY a.linea_id
  LOOP
    SELECT * INTO v_linea FROM inventario_lineas WHERE id = v_chk.linea_id FOR UPDATE;

    IF v_linea.id IS NULL THEN
      RAISE EXCEPTION 'Una de las líneas de stock ya no existe (refrescá la pantalla)';
    END IF;
    IF v_linea.tenant_id IS DISTINCT FROM v_caller_tenant THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;
    IF v_linea.producto_id IS DISTINCT FROM p_madre_id THEN
      RAISE EXCEPTION 'La línea % no pertenece a "%"', v_linea.lpn, v_madre.nombre;
    END IF;
    IF NOT COALESCE(v_linea.activo, true) THEN
      RAISE EXCEPTION 'La línea % está inactiva', v_linea.lpn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM inventario_lineas c
      WHERE c.tenant_id = v_linea.tenant_id AND c.parent_lpn_id = v_linea.lpn
        AND COALESCE(c.activo, true)
    ) THEN
      RAISE EXCEPTION 'La línea % es un LPN contenedor (tiene LPN hijos): desarmalo antes de reasignar', v_linea.lpn;
    END IF;
    IF v_chk.total <= 0 THEN
      RAISE EXCEPTION 'Las cantidades a reasignar tienen que ser mayores a cero';
    END IF;

    IF v_serializado THEN
      -- 🛑 Bloquear las SERIES de esta línea, no solo la línea: el `FOR UPDATE` de arriba no frena
      -- a una venta concurrente que consuma una serie (marca `activo=false`/`reservado`) sin tocar
      -- la fila de `inventario_lineas`. Sin este lock, entre la validación y el movimiento alguien
      -- podría vender justo la serie que estamos por reasignar.
      PERFORM 1 FROM inventario_series s
        WHERE s.linea_id = v_linea.id AND COALESCE(s.activo, true)
        FOR UPDATE;

      -- En serializados la "capacidad" de la línea son sus series activas, NO `cantidad`
      -- (que para estos productos es decorativa — ver cabecera).
      IF v_chk.total > (SELECT count(*) FROM inventario_series s
                        WHERE s.linea_id = v_linea.id AND COALESCE(s.activo, true)
                          AND NOT COALESCE(s.reservado, false)) THEN
        RAISE EXCEPTION 'La línea % no tiene esa cantidad de números de serie disponibles (¿alguno está reservado o vendido?)', v_linea.lpn;
      END IF;
    ELSE
      IF COALESCE(v_linea.cantidad_reservada, 0) > 0 THEN
        RAISE EXCEPTION 'La línea % tiene % unidad(es) reservadas para un pedido: liberá la reserva antes de reasignar',
          v_linea.lpn, v_linea.cantidad_reservada;
      END IF;
      IF v_chk.total > v_linea.cantidad THEN
        RAISE EXCEPTION 'La línea % tiene % unidades y se intentan reasignar %',
          v_linea.lpn, v_linea.cantidad, v_chk.total;
      END IF;
    END IF;

    v_total_lineas := v_total_lineas + 1;
  END LOOP;

  -- Validar los hijos destino
  FOR v_hijo IN
    SELECT DISTINCT (e->>'hijo_id')::uuid AS hijo_id
    FROM jsonb_array_elements(p_asignaciones) e
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM productos h
      WHERE h.id = v_hijo.hijo_id
        AND h.producto_padre_id = p_madre_id
        AND h.tenant_id = v_caller_tenant
    ) THEN
      RAISE EXCEPTION 'El destino elegido no es una variante de "%"', v_madre.nombre;
    END IF;
    -- La madre y sus hijos tienen que compartir el modo de trazabilidad: mover series a un hijo
    -- que no las maneja (o al revés) dejaría el stock contado de dos formas distintas.
    IF EXISTS (SELECT 1 FROM productos h WHERE h.id = v_hijo.hijo_id
               AND COALESCE(h.tiene_series,false) IS DISTINCT FROM v_serializado) THEN
      RAISE EXCEPTION 'La variante destino no maneja números de serie igual que "%": no se puede mover stock entre los dos modos', v_madre.nombre;
    END IF;
  END LOOP;

  -- ── PASO 2: aplicar ───────────────────────────────────────────────────────────────────
  FOR v_asig IN
    SELECT (e->>'linea_id')::uuid AS linea_id,
           (e->>'hijo_id')::uuid  AS hijo_id,
           CASE WHEN v_serializado
                THEN jsonb_array_length(COALESCE(e->'series','[]'::jsonb))
                ELSE (e->>'cantidad')::int END AS cantidad,
           CASE WHEN v_serializado THEN ARRAY(
                  SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(e->'series','[]'::jsonb)) x
                ) ELSE ARRAY[]::uuid[] END AS series,
           (SELECT count(*) FROM jsonb_array_elements(p_asignaciones) e2
             WHERE (e2->>'linea_id')::uuid = (e->>'linea_id')::uuid) AS destinos_de_la_linea
    FROM jsonb_array_elements(p_asignaciones) e
  LOOP
    IF v_asig.cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida';
    END IF;

    SELECT * INTO v_linea FROM inventario_lineas WHERE id = v_asig.linea_id;
    v_series   := v_asig.series;
    v_n_series := v_asig.cantidad;

    SELECT stock_actual INTO v_madre_antes FROM productos WHERE id = p_madre_id;
    SELECT stock_actual INTO v_hijo_antes  FROM productos WHERE id = v_asig.hijo_id;

    IF v_serializado THEN
      -- Cada serie elegida tiene que ser de ESTA línea, de la madre, activa y no reservada.
      IF EXISTS (
        SELECT 1 FROM unnest(v_series) sid
        WHERE NOT EXISTS (
          SELECT 1 FROM inventario_series s
          WHERE s.id = sid AND s.linea_id = v_asig.linea_id AND s.producto_id = p_madre_id
            AND s.tenant_id = v_caller_tenant AND COALESCE(s.activo, true)
            AND NOT COALESCE(s.reservado, false)
        )
      ) THEN
        RAISE EXCEPTION 'Alguno de los números de serie elegidos no está disponible en el LPN % (puede estar vendido, reservado o pertenecer a otro LPN)', v_linea.lpn;
      END IF;

      -- 🛑 En serializados NUNCA se re-apunta la línea, SIEMPRE nace un LPN nuevo para el hijo.
      -- Motivo: una línea puede tener series INACTIVAS (ya vendidas). Esas pertenecen al historial
      -- del SKU con el que se vendieron (la madre) y NO se pueden re-etiquetar sin falsear la
      -- trazabilidad — pero si re-apuntáramos la línea, quedarían colgando de un LPN que ahora es
      -- de otro producto (serie.producto_id ≠ linea.producto_id). Creando un LPN nuevo, el viejo
      -- conserva su historial intacto y el nuevo queda 100% coherente.
      -- `cantidad` va en 0 a propósito: en serializados el stock lo cuentan las series (misma
      -- convención que usa el ingreso).
      BEGIN
        INSERT INTO inventario_lineas (
          tenant_id, producto_id, lpn, cantidad, cantidad_reservada,
          estado_id, ubicacion_id, proveedor_id, nro_lote, fecha_vencimiento,
          precio_costo_snapshot, precio_venta_snapshot, activo, sucursal_id,
          notas, pais_origen, parent_lpn_id, talle, color, encaje, formato, sabor_aroma
        ) VALUES (
          v_linea.tenant_id, v_asig.hijo_id, '', 0, 0,
          v_linea.estado_id, v_linea.ubicacion_id, v_linea.proveedor_id, v_linea.nro_lote, v_linea.fecha_vencimiento,
          v_linea.precio_costo_snapshot, v_linea.precio_venta_snapshot, true, v_linea.sucursal_id,
          v_linea.notas, v_linea.pais_origen, v_linea.parent_lpn_id,
          v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma
        ) RETURNING id INTO v_dest_linea;

        UPDATE inventario_series
          SET producto_id = v_asig.hijo_id, linea_id = v_dest_linea
          WHERE id = ANY(v_series);

        -- Si el LPN origen se quedó sin series activas, se desactiva (que ningún picker lo ofrezca).
        -- Sus series inactivas siguen colgando de él, con el producto con el que se vendieron.
        UPDATE inventario_lineas SET activo = false, updated_at = now()
          WHERE id = v_asig.linea_id
            AND NOT EXISTS (SELECT 1 FROM inventario_series s
                            WHERE s.linea_id = v_asig.linea_id AND COALESCE(s.activo, true));
      END;

    ELSIF v_asig.destinos_de_la_linea = 1 AND v_asig.cantidad = v_linea.cantidad THEN
      UPDATE inventario_lineas
        SET producto_id = v_asig.hijo_id, estructura_id = NULL, updated_at = now()
        WHERE id = v_asig.linea_id;
      v_dest_linea := v_asig.linea_id;
    ELSE
      UPDATE inventario_lineas
        SET cantidad = cantidad - v_asig.cantidad,
            activo   = (cantidad - v_asig.cantidad) > 0,
            updated_at = now()
        WHERE id = v_asig.linea_id;

      INSERT INTO inventario_lineas (
        tenant_id, producto_id, lpn, cantidad, cantidad_reservada,
        estado_id, ubicacion_id, proveedor_id, nro_lote, fecha_vencimiento,
        precio_costo_snapshot, precio_venta_snapshot, activo, sucursal_id,
        notas, pais_origen, parent_lpn_id, talle, color, encaje, formato, sabor_aroma
      ) VALUES (
        v_linea.tenant_id, v_asig.hijo_id, '', v_asig.cantidad, 0,
        v_linea.estado_id, v_linea.ubicacion_id, v_linea.proveedor_id, v_linea.nro_lote, v_linea.fecha_vencimiento,
        v_linea.precio_costo_snapshot, v_linea.precio_venta_snapshot, true, v_linea.sucursal_id,
        v_linea.notas, v_linea.pais_origen, v_linea.parent_lpn_id,
        v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma
      ) RETURNING id INTO v_dest_linea;
    END IF;

    SELECT stock_actual INTO v_madre_desp FROM productos WHERE id = p_madre_id;
    SELECT stock_actual INTO v_hijo_desp  FROM productos WHERE id = v_asig.hijo_id;

    INSERT INTO movimientos_stock (
      tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues,
      motivo, sucursal_id, linea_id, usuario_id
    ) VALUES (
      v_caller_tenant, p_madre_id, 'reasignacion_variante', v_asig.cantidad, v_madre_antes, v_madre_desp,
      'Reasignación de stock sin variante asignada → ' ||
        COALESCE((SELECT variante_diferenciador FROM productos WHERE id = v_asig.hijo_id), 'variante') ||
        ' (LPN ' || v_linea.lpn || ')' ||
        CASE WHEN v_serializado THEN ' · series: ' || COALESCE((
          SELECT string_agg(s.nro_serie, ', ' ORDER BY s.nro_serie)
          FROM inventario_series s WHERE s.id = ANY(v_series)
        ), '') ELSE '' END,
      v_linea.sucursal_id, v_asig.linea_id, auth.uid()
    );

    INSERT INTO movimientos_stock (
      tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues,
      motivo, sucursal_id, linea_id, usuario_id
    ) VALUES (
      v_caller_tenant, v_asig.hijo_id, 'reasignacion_variante', v_asig.cantidad, v_hijo_antes, v_hijo_desp,
      'Stock recibido de "' || v_madre.nombre || '" (sin variante asignada, LPN ' || v_linea.lpn || ')' ||
        CASE WHEN v_serializado THEN ' · series: ' || COALESCE((
          SELECT string_agg(s.nro_serie, ', ' ORDER BY s.nro_serie)
          FROM inventario_series s WHERE s.id = ANY(v_series)
        ), '') ELSE '' END,
      v_linea.sucursal_id, v_dest_linea, auth.uid()
    );

    v_total_unid := v_total_unid + v_asig.cantidad;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'unidades_reasignadas', v_total_unid,
    'lineas_afectadas', v_total_lineas,
    'serializado', v_serializado,
    'stock_sin_asignar_restante', (SELECT stock_actual FROM productos WHERE id = p_madre_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) IS
  'Reparte el stock "sin variante asignada" de una madre agrupadora entre sus variantes hijo. Atómica, líneas bloqueadas FOR UPDATE, par de movimientos_stock (neto cero) por asignación. En productos SERIALIZADOS (mig 313) cada asignación trae la LISTA de series a mover (no una cantidad): se mudan las filas de inventario_series, que es lo que cuenta el stock de esos productos.';
