-- ============================================================
-- 344_fix_ubicaciones_backfill_gap_334_335_en_prod.sql
--
-- Fix de un GAP DE DEPLOY encontrado el 2026-08-07 durante el deploy de v1.160.0: las
-- migraciones 334 (ubicaciones_arbol_tipo_logico) y 335 (producto_ubicacion_exhibicion) —
-- ya commiteadas en `main` desde un release anterior (v1.157.0) y ya aplicadas en DEV —
-- NUNCA se habían aplicado en PROD. `list_migrations` de PROD saltaba de 333 directo a
-- 336. Nadie lo detectó porque las columnas nuevas son todas ADD COLUMN IF NOT EXISTS
-- (no hay guard que grite "falta una migración vieja").
--
-- El problema se volvió ACTIVO recién con esta sesión: la migración 339 (Fase U5, este
-- mismo deploy) dropea `ubicaciones.tipo_ubicacion` asumiendo que 334 ya reescribió a las
-- 6 funciones SQL que la leían. Como 334 nunca corrió en PROD, esas 6 funciones (todas de
-- WMS/Pedidos: fn_wms_elegir_ubicacion_picking, fn_generar_tareas_reabastecimiento_umbral,
-- fn_generar_tareas_picking_envio/pedido_stock/pedido_venta, fn_lanzar_bolsa_pedidos)
-- quedaron en PROD referenciando una columna que YA NO EXISTE — confirmado con
-- pg_get_functiondef contra PROD antes de escribir esto: las 6 devuelven `true` a
-- `LIKE '%tipo_ubicacion%'`. Cualquier invocación real (lanzar un pedido, reabastecer,
-- armar una bolsa de picking) rompe en runtime con "column tipo_ubicacion does not exist".
-- Esto es Regla de Oro #0 (inventario) — se corrige ANTES de continuar con el resto del
-- deploy, no después.
--
-- Este archivo NO es un copy-paste ciego de 334+335: es su contenido completo (columnas,
-- guards/triggers, backfill de `codigo`, y el rewrite de las 6 funciones) MENOS la única
-- línea que ya no puede ejecutarse (el backfill de tipo_logico/subtipo_almacenamiento
-- LEYENDO tipo_ubicacion, que 339 ya borró). Ver el reemplazo de esa sección más abajo.
-- Todo el resto es 100% idéntico a 334/335, por lo que re-aplicarlo en DEV (donde 334/335
-- ya corrieron con su numeración original) es un no-op idempotente y seguro — mismo
-- criterio que cualquier migración con ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ── 1) Columnas nuevas ──────────────────────────────────────────────────────────────────

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS padre_ubicacion_id uuid REFERENCES ubicaciones(id),
  ADD COLUMN IF NOT EXISTS tipo_logico text,
  ADD COLUMN IF NOT EXISTS subtipo_almacenamiento text,
  ADD COLUMN IF NOT EXISTS codigo text,
  ADD COLUMN IF NOT EXISTS pos_x numeric,
  ADD COLUMN IF NOT EXISTS pos_y numeric,
  ADD COLUMN IF NOT EXISTS orientacion_deg numeric;

COMMENT ON COLUMN ubicaciones.padre_ubicacion_id IS
  'Ubicación padre en el árbol contenedora→nivel (NULL = raíz). Mismo patrón self-FK que producto_presentaciones.padre_linea_id (mig 307). Sin ON DELETE: no se puede borrar un padre con hijos.';
COMMENT ON COLUMN ubicaciones.tipo_logico IS
  'Clasificación de cara al negocio (mig 334, relevamiento Ubicaciones A5): exhibicion/mostrador (venta directa) o picking/almacenamiento (reabastecimiento). Solo se puede setear en un nodo SIN HIJOS (ver trg_ubic_tipo_logico_guard) — un nodo hoja de hoy es, por construcción, su propio único "nivel".';
COMMENT ON COLUMN ubicaciones.subtipo_almacenamiento IS
  'Sub-tipo técnico WMS, solo válido cuando tipo_logico=''almacenamiento'' (reemplaza al viejo tipo_ubicacion picking/bulk/estiba/camara/cross_dock/staging para todo lo que no sea picking).';
COMMENT ON COLUMN ubicaciones.codigo IS
  'Identificador técnico estructurado (B1-B3 del relevamiento), autogenerado por trg_ubic_autogenerar_codigo, editable con formato validado. Coexiste con nombre (que sigue siendo la etiqueta legible).';
COMMENT ON COLUMN ubicaciones.pos_x IS 'Reservado para Almacén 360 (B4) — coordenada de grilla, sin UI todavía.';
COMMENT ON COLUMN ubicaciones.pos_y IS 'Reservado para Almacén 360 (B4) — coordenada de grilla, sin UI todavía.';
COMMENT ON COLUMN ubicaciones.orientacion_deg IS 'Reservado para Almacén 360 (B4) — orientación en grados, sin UI todavía.';

CREATE INDEX IF NOT EXISTS idx_ubicaciones_padre ON ubicaciones (padre_ubicacion_id);

ALTER TABLE ubicaciones DROP CONSTRAINT IF EXISTS chk_ubicaciones_tipo_logico;
ALTER TABLE ubicaciones ADD CONSTRAINT chk_ubicaciones_tipo_logico
  CHECK (tipo_logico IS NULL OR tipo_logico IN ('exhibicion','mostrador','picking','almacenamiento'));

ALTER TABLE ubicaciones DROP CONSTRAINT IF EXISTS chk_ubicaciones_subtipo_almacenamiento;
ALTER TABLE ubicaciones ADD CONSTRAINT chk_ubicaciones_subtipo_almacenamiento
  CHECK (subtipo_almacenamiento IS NULL OR subtipo_almacenamiento IN ('bulk','estiba','camara','cross_dock','staging'));

ALTER TABLE ubicaciones DROP CONSTRAINT IF EXISTS chk_ubicaciones_codigo_formato;
ALTER TABLE ubicaciones ADD CONSTRAINT chk_ubicaciones_codigo_formato
  CHECK (codigo IS NULL OR codigo ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$');

-- ── 2) Guard anti-ciclo (mismo esqueleto que trg_pp_no_ciclo, mig 307) ─────────────────

CREATE OR REPLACE FUNCTION trg_ubic_no_ciclo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cursor       uuid := NEW.padre_ubicacion_id;
  v_hops         int  := 0;
  v_padre_tenant uuid;
BEGIN
  IF NEW.padre_ubicacion_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.padre_ubicacion_id = NEW.id THEN
    RAISE EXCEPTION 'Una ubicación no puede ser su propio padre';
  END IF;
  SELECT tenant_id INTO v_padre_tenant FROM ubicaciones WHERE id = NEW.padre_ubicacion_id;
  IF v_padre_tenant IS NULL OR v_padre_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'El padre de una ubicación debe pertenecer al mismo tenant';
  END IF;
  WHILE v_cursor IS NOT NULL LOOP
    v_hops := v_hops + 1;
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'Ciclo en el árbol de ubicaciones (padre_ubicacion_id)';
    END IF;
    IF v_hops > 50 THEN
      RAISE EXCEPTION 'Cadena de ubicaciones demasiado profunda (posible ciclo)';
    END IF;
    SELECT padre_ubicacion_id INTO v_cursor FROM ubicaciones WHERE id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ubic_no_ciclo ON ubicaciones;
CREATE TRIGGER trg_ubic_no_ciclo
  BEFORE INSERT OR UPDATE OF padre_ubicacion_id ON ubicaciones
  FOR EACH ROW EXECUTE FUNCTION trg_ubic_no_ciclo();

-- ── 3) Guard tipo_logico: subtipo solo con almacenamiento; tipo_logico solo en hojas ───

CREATE OR REPLACE FUNCTION trg_ubic_tipo_logico_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo_logico IS DISTINCT FROM 'almacenamiento' AND NEW.subtipo_almacenamiento IS NOT NULL THEN
    RAISE EXCEPTION 'subtipo_almacenamiento solo aplica cuando tipo_logico = ''almacenamiento''';
  END IF;

  IF NEW.tipo_logico IS NOT NULL AND EXISTS (
    SELECT 1 FROM ubicaciones WHERE padre_ubicacion_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'No se puede asignar tipo_logico a "%": tiene niveles hijos — el tipo lógico va en el nivel hoja, no en la contenedora', NEW.nombre;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ubic_tipo_logico_guard ON ubicaciones;
CREATE TRIGGER trg_ubic_tipo_logico_guard
  BEFORE INSERT OR UPDATE OF tipo_logico, subtipo_almacenamiento ON ubicaciones
  FOR EACH ROW EXECUTE FUNCTION trg_ubic_tipo_logico_guard();

-- ── 4) Guard duro: no se puede agregar un hijo bajo un padre operativamente activo ─────
-- Regla #0 — inventario real. No es un aviso-y-dejar-pasar: si el padre tiene tipo_logico,
-- stock activo, umbrales configurados o tareas WMS pendientes, hay que reubicar/limpiar
-- eso primero, explícitamente, antes de convertirlo en una contenedora organizativa.
-- SECURITY DEFINER a propósito (hallazgo de migration-reviewer): inventario_lineas y
-- wms_tareas tienen RLS por SUCURSAL (auth_ve_todas_sucursales()/auth_user_sucursal()),
-- a diferencia de ubicaciones que es tenant-only. Sin SECURITY DEFINER, un usuario fijado a
-- una sola sucursal podría reparentar una ubicación cuyo padre tiene stock/tareas en OTRA
-- sucursal que no puede ver — el EXISTS le daría falso negativo y el guard no dispararía.
-- La función no devuelve datos al caller, solo permite/aborta el write (mismo criterio que
-- los demás guards SECURITY DEFINER del repo, ej. mig 166/333).

CREATE OR REPLACE FUNCTION trg_ubic_guard_padre_operativo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_padre_tipo_logico text;
  v_padre_nombre      text;
BEGIN
  IF NEW.padre_ubicacion_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.padre_ubicacion_id IS NOT DISTINCT FROM OLD.padre_ubicacion_id THEN
    RETURN NEW;
  END IF;

  SELECT tipo_logico, nombre INTO v_padre_tipo_logico, v_padre_nombre
  FROM ubicaciones WHERE id = NEW.padre_ubicacion_id;

  IF v_padre_tipo_logico IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede agregar un nivel dentro de "%": todavía tiene un tipo lógico (%) asignado — limpialo antes de convertirla en contenedora', v_padre_nombre, v_padre_tipo_logico;
  END IF;

  IF EXISTS (SELECT 1 FROM inventario_lineas WHERE ubicacion_id = NEW.padre_ubicacion_id AND activo = true) THEN
    RAISE EXCEPTION 'No se puede agregar un nivel dentro de "%": tiene stock activo — reubicá el stock a un nivel específico antes', v_padre_nombre;
  END IF;

  IF EXISTS (SELECT 1 FROM producto_ubicacion_umbrales WHERE ubicacion_id = NEW.padre_ubicacion_id) THEN
    RAISE EXCEPTION 'No se puede agregar un nivel dentro de "%": tiene umbrales de reabastecimiento configurados — reasignalos a un nivel específico antes', v_padre_nombre;
  END IF;

  IF EXISTS (
    SELECT 1 FROM wms_tareas
    WHERE (ubicacion_origen_id = NEW.padre_ubicacion_id OR ubicacion_destino_id = NEW.padre_ubicacion_id)
      AND estado IN ('pendiente','en_curso')
  ) THEN
    RAISE EXCEPTION 'No se puede agregar un nivel dentro de "%": tiene tareas WMS pendientes o en curso — completalas o cancelalas antes', v_padre_nombre;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ubic_guard_padre_operativo ON ubicaciones;
CREATE TRIGGER trg_ubic_guard_padre_operativo
  BEFORE INSERT OR UPDATE OF padre_ubicacion_id ON ubicaciones
  FOR EACH ROW EXECUTE FUNCTION trg_ubic_guard_padre_operativo();

-- ── 5) Autogeneración de código (B1c) — raíz: U01, U02...; hijo: <código padre>-1, -2... ──
-- Normaliza a mayúsculas siempre (autogenerado o editado a mano) para que el formato del
-- CHECK sea consistente sin obligar al usuario a tipear en mayúsculas.

CREATE OR REPLACE FUNCTION trg_ubic_autogenerar_codigo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_seq       int;
  v_padre_cod text;
  v_candidato text;
BEGIN
  NEW.codigo := NULLIF(upper(trim(NEW.codigo)), '');

  IF NEW.codigo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- v_seq arranca en 0 (no en un count(*) de filas existentes): el backfill de la sección 6
  -- reusa este trigger vía UPDATE sobre filas que YA EXISTEN físicamente, así que un count(*)
  -- se contaría a sí mismo antes de asignar ningún código y arrancaría en U22/U05 en vez de
  -- U01 (hallazgo de migration-reviewer). EXIT WHEN NOT EXISTS ya garantiza el primer libre.
  IF NEW.padre_ubicacion_id IS NULL THEN
    v_seq := 0;
    LOOP
      v_seq := v_seq + 1;
      v_candidato := 'U' || lpad(v_seq::text, 2, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ubicaciones WHERE tenant_id = NEW.tenant_id AND codigo = v_candidato);
    END LOOP;
  ELSE
    SELECT codigo INTO v_padre_cod FROM ubicaciones WHERE id = NEW.padre_ubicacion_id;
    v_seq := 0;
    LOOP
      v_seq := v_seq + 1;
      v_candidato := v_padre_cod || '-' || v_seq::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ubicaciones WHERE tenant_id = NEW.tenant_id AND codigo = v_candidato);
    END LOOP;
  END IF;

  NEW.codigo := v_candidato;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ubic_autogenerar_codigo ON ubicaciones;
CREATE TRIGGER trg_ubic_autogenerar_codigo
  BEFORE INSERT OR UPDATE OF codigo ON ubicaciones
  FOR EACH ROW EXECUTE FUNCTION trg_ubic_autogenerar_codigo();

-- ── 6) Backfill de las filas existentes ──────────────────────────────────────────────
-- codigo: se reusa el trigger de autogeneración de arriba (evita duplicar la lógica de
-- unicidad/loop) forzando un UPDATE ... SET codigo = '' fila por fila, en orden de alta
-- por tenant, para que la numeración U01/U02/... siga el orden histórico real.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM ubicaciones WHERE codigo IS NULL ORDER BY tenant_id, created_at LOOP
    UPDATE ubicaciones SET codigo = '' WHERE id = r.id;
  END LOOP;
END $$;

-- tipo_logico/subtipo_almacenamiento: EN 334 esto se mapeaba desde tipo_ubicacion. Acá no
-- se puede — tipo_ubicacion ya no existe en PROD (dropeada por 339 antes de que 334
-- corriera). Se aplica el mismo valor neutro de fallback que 334 ya usaba para las filas
-- sin tipo cargado ('almacenamiento' sin subtipo — no le da ningún rol operativo nuevo a
-- una ubicación que hoy no tenía ninguno; reclasificable después desde Config, no
-- bloqueante). Impacto real conocido: en PROD hay 1 ubicación que el comentario de 334
-- registraba como tipo_ubicacion='camara' (de un total de 4 en el tenant de prueba) — esa
-- clasificación puntual se pierde (no hay forma de recuperarla, la columna ya no existe) y
-- queda para reclasificar a mano; cero impacto en stock/fiscal/contable (no hay cliente
-- real en PROD, y la propia mig 334 ya documentaba este fallback como no bloqueante).
--
-- Guard extra vs. el UPDATE original de 334: excluye filas que ya son PADRE de otra
-- ubicación (tienen hijos) — necesario para que esto sea seguro de re-ejecutar en DEV, que
-- hoy ya tiene un árbol real con contenedoras (tipo_logico debe quedar NULL en una
-- contenedora; trg_ubic_tipo_logico_guard lo rechazaría si no se filtra). En PROD, sin
-- árbol armado todavía, esto no excluye ninguna fila.
UPDATE ubicaciones SET
  tipo_logico = 'almacenamiento',
  subtipo_almacenamiento = NULL
WHERE tipo_logico IS NULL
  AND id NOT IN (SELECT padre_ubicacion_id FROM ubicaciones WHERE padre_ubicacion_id IS NOT NULL);

ALTER TABLE ubicaciones ALTER COLUMN codigo SET NOT NULL;

ALTER TABLE ubicaciones DROP CONSTRAINT IF EXISTS uq_ubicaciones_tenant_codigo;
ALTER TABLE ubicaciones ADD CONSTRAINT uq_ubicaciones_tenant_codigo UNIQUE (tenant_id, codigo);

-- ── 7) Rewrite de las 6 funciones que leían tipo_ubicacion ──────────────────────────────
-- La columna vieja tipo_ubicacion NO se dropea todavía (Fase U5, cuando el grep de
-- lectores dé 0 — mismo patrón ya usado para las columnas fiscales de tenants en F3b/F4).

CREATE OR REPLACE FUNCTION public.fn_wms_elegir_ubicacion_picking(
  p_tenant_id   uuid,
  p_sucursal_id uuid,
  p_producto_id uuid
)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT u.id
  FROM ubicaciones u
  LEFT JOIN tenants t
    ON t.id = p_tenant_id
  LEFT JOIN vw_ubicacion_ocupacion oc
    ON oc.ubicacion_id = u.id AND oc.tenant_id = u.tenant_id
  WHERE u.tenant_id = p_tenant_id
    AND u.activo = true
    AND u.tipo_logico = 'picking'
    AND (u.sucursal_id IS NULL OR u.sucursal_id = p_sucursal_id)
  ORDER BY
    (EXISTS (
      SELECT 1 FROM inventario_lineas il
      WHERE il.ubicacion_id = u.id AND il.producto_id = p_producto_id AND il.activo = true
    )) DESC,
    (NOT (
         (COALESCE(u.capacidad_pallets, 0) > 0 AND COALESCE(oc.lpn_activos, 0) >= u.capacidad_pallets)
      OR (COALESCE(u.peso_max_kg, 0)     > 0 AND COALESCE(oc.peso_kg, 0)     >= u.peso_max_kg)
      OR (COALESCE(t.cubicaje_habilitado, false)
          AND COALESCE(u.alto_cm, 0) > 0 AND COALESCE(u.ancho_cm, 0) > 0 AND COALESCE(u.largo_cm, 0) > 0
          AND COALESCE(oc.volumen_m3, 0) >=
              (u.alto_cm * u.ancho_cm * u.largo_cm / 1000000.0)
              * GREATEST(LEAST(COALESCE(t.cubicaje_factor_aprovechamiento, 0.70), 1), 0.01))
    )) DESC,
    u.secuencia NULLS LAST,
    u.prioridad,
    u.id
  LIMIT 1
$$;

COMMENT ON FUNCTION public.fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) IS
  'Destino de una tarea de reabastecimiento (bulk→picking). Mig 334: filtra por tipo_logico en vez de tipo_ubicacion (árbol de Ubicaciones) — misma lógica de capacidad/desempate de la mig 326, sin cambios.';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_reabastecimiento_umbral(p_tenant_id uuid)
RETURNS TABLE (tarea_id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_habilitado boolean;
  v_umbral     RECORD;
  v_stock      integer;
  v_origen_id  uuid;
  v_cantidad   integer;
  v_disponible integer;
  v_nueva_id   uuid;
BEGIN
  SELECT wms_reabastecimiento_umbral INTO v_habilitado FROM tenants WHERE id = p_tenant_id;
  IF NOT COALESCE(v_habilitado, false) THEN RETURN; END IF;

  FOR v_umbral IN
    SELECT pu.producto_id, pu.ubicacion_id, pu.stock_minimo, pu.stock_maximo, u.sucursal_id
    FROM producto_ubicacion_umbrales pu
    JOIN ubicaciones u ON u.id = pu.ubicacion_id
    WHERE pu.tenant_id = p_tenant_id
  LOOP
    SELECT COALESCE(SUM(il.cantidad), 0) INTO v_stock
    FROM inventario_lineas il
    WHERE il.producto_id = v_umbral.producto_id AND il.ubicacion_id = v_umbral.ubicacion_id AND il.activo = true;

    CONTINUE WHEN v_stock >= v_umbral.stock_minimo;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM wms_tareas wt
      WHERE wt.tenant_id = p_tenant_id AND wt.tipo = 'replenishment' AND wt.origen = 'umbral'
        AND wt.producto_id = v_umbral.producto_id AND wt.ubicacion_destino_id = v_umbral.ubicacion_id
        AND wt.estado IN ('pendiente','en_curso')
    );

    v_cantidad := COALESCE(v_umbral.stock_maximo, v_umbral.stock_minimo) - v_stock;
    CONTINUE WHEN v_cantidad <= 0;

    SELECT il.ubicacion_id INTO v_origen_id
    FROM inventario_lineas il
    JOIN ubicaciones u2 ON u2.id = il.ubicacion_id
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_umbral.producto_id AND il.activo = true
      AND u2.subtipo_almacenamiento IN ('bulk','estiba','camara')
      AND il.ubicacion_id <> v_umbral.ubicacion_id
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
    ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
    LIMIT 1;

    CONTINUE WHEN v_origen_id IS NULL;

    SELECT COALESCE(SUM(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    WHERE il.tenant_id = p_tenant_id AND il.producto_id = v_umbral.producto_id
      AND il.ubicacion_id = v_origen_id AND il.activo = true;

    v_cantidad := LEAST(v_cantidad, v_disponible);
    CONTINUE WHEN v_cantidad <= 0;

    INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, origen, notas)
    VALUES (p_tenant_id, v_umbral.sucursal_id, 'replenishment', v_umbral.producto_id, v_cantidad, v_origen_id, v_umbral.ubicacion_id, 'umbral',
            'Por debajo del mínimo configurado (' || v_umbral.stock_minimo || ') — ' || fn_wms_describir_cantidad(v_umbral.producto_id, v_cantidad))
    RETURNING id INTO v_nueva_id;

    RETURN QUERY SELECT v_nueva_id;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_reabastecimiento_umbral(uuid) IS
  'Mig 334: origen de reabastecimiento filtra por subtipo_almacenamiento en vez de tipo_ubicacion. Sin cambios de comportamiento.';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_envio(p_envio_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_envio       RECORD;
  v_item        RECORD;
  v_despacho    RECORD;
  v_plan_item   jsonb;
  v_ubic_tipo   text;
  v_destino_id  uuid;
  v_reab_on     boolean;
  v_reab_id     uuid;
  v_pick_id     uuid;
  v_tiene_filas boolean;
BEGIN
  SELECT * INTO v_envio FROM envios WHERE id = p_envio_id;
  IF v_envio IS NULL THEN
    RAISE EXCEPTION 'Envío inexistente o sin permisos';
  END IF;
  IF v_envio.venta_id IS NULL THEN
    RAISE EXCEPTION 'El envío no tiene una venta asociada — no hay LPN que picking pueda seguir';
  END IF;

  SELECT wms_reabastecimiento_on_demand INTO v_reab_on FROM tenants WHERE id = v_envio.tenant_id;

  IF EXISTS (SELECT 1 FROM wms_tareas WHERE envio_id = p_envio_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.envio_id = p_envio_id;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT vi.id, vi.producto_id, vi.cantidad, vi.lpn_plan
    FROM venta_items vi WHERE vi.venta_id = v_envio.venta_id
  LOOP
    v_tiene_filas := false;

    FOR v_despacho IN
      SELECT vid.lpn, vid.ubicacion_id, vid.cantidad
      FROM venta_item_despachos vid
      WHERE vid.venta_item_id = v_item.id
    LOOP
      v_tiene_filas := true;
      SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_despacho.ubicacion_id;

      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
      VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_despacho.cantidad, v_despacho.ubicacion_id, v_despacho.lpn, 'envio', p_envio_id,
              fn_wms_describir_cantidad(v_item.producto_id, v_despacho.cantidad::integer) ||
              (CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' (fuera de zona de picking — retirar igual, ya está vendido)' ELSE '' END))
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END LOOP;

    IF NOT v_tiene_filas AND v_item.lpn_plan IS NOT NULL THEN
      FOR v_plan_item IN SELECT * FROM jsonb_array_elements(v_item.lpn_plan)
      LOOP
        DECLARE
          v_linea_id  uuid := NULLIF(v_plan_item->>'linea_id','')::uuid;
          v_lpn_txt   text := v_plan_item->>'lpn';
          v_cant_plan integer := ROUND((v_plan_item->>'cantidad')::numeric);
          v_ubic_id   uuid;
        BEGIN
          IF v_linea_id IS NULL OR v_cant_plan IS NULL OR v_cant_plan <= 0 THEN CONTINUE; END IF;
          SELECT il.ubicacion_id, u.tipo_logico INTO v_ubic_id, v_ubic_tipo
          FROM inventario_lineas il LEFT JOIN ubicaciones u ON u.id = il.ubicacion_id
          WHERE il.id = v_linea_id;

          IF v_ubic_id IS NOT NULL AND v_ubic_tipo = 'picking' THEN
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, v_ubic_id, v_lpn_txt, 'envio', p_envio_id,
                    fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' (reserva pendiente de despacho)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;

          ELSIF v_reab_on THEN
            v_destino_id := fn_wms_elegir_ubicacion_picking(v_envio.tenant_id, v_envio.sucursal_id, v_item.producto_id);
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'replenishment', v_item.producto_id, v_cant_plan, v_ubic_id, v_destino_id, v_lpn_txt, 'envio', p_envio_id,
                    'Reabastecer ' || fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' a zona de picking (reserva pendiente)')
            RETURNING id INTO v_reab_id;
            RETURN QUERY SELECT v_reab_id, 'replenishment'::text;

            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, tarea_precedente_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, COALESCE(v_destino_id, v_ubic_id), v_lpn_txt, 'envio', p_envio_id, v_reab_id,
                    fn_wms_describir_cantidad(v_item.producto_id, v_cant_plan) || ' (reserva pendiente de despacho)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;
          ELSE
            INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, envio_id, notas)
            VALUES (v_envio.tenant_id, v_envio.sucursal_id, 'picking', v_item.producto_id, v_cant_plan, v_ubic_id, v_lpn_txt, 'envio', p_envio_id,
                    'Ubicación fuera de zona picking — reabastecimiento on-demand deshabilitado (reserva pendiente)')
            RETURNING id INTO v_pick_id;
            RETURN QUERY SELECT v_pick_id, 'picking'::text;
          END IF;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_envio(uuid) IS
  'Mig 334: chequeo de zona de picking usa tipo_logico en vez de tipo_ubicacion. Sin cambios de comportamiento (mig 291: Fuente 1 nunca encadena reabastecimiento).';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido_stock(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido       RECORD;
  v_item         RECORD;
  v_producto     RECORD;
  v_linea        RECORD;
  v_pendiente    numeric;
  v_disponible   numeric;
  v_tomar        numeric;
  v_reab_on      boolean;
  v_ubic_tipo    text;
  v_destino_id   uuid;
  v_reab_id      uuid;
  v_pick_id      uuid;
  v_domicilio_id uuid;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN
    RAISE EXCEPTION 'Pedido inexistente o sin permisos';
  END IF;

  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
    RETURN;
  END IF;

  IF v_pedido.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El pedido está cancelado';
  END IF;
  IF v_pedido.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo';
  END IF;

  SELECT wms_reabastecimiento_on_demand INTO v_reab_on FROM tenants WHERE id = v_pedido.tenant_id;

  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    CONTINUE WHEN v_item.pendiente <= 0;

    SELECT COALESCE(SUM(il.cantidad - COALESCE(il.cantidad_reservada,0)), 0) INTO v_disponible
    FROM inventario_lineas il
    WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
      AND il.activo = true AND il.ubicacion_id IS NOT NULL
      AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
      AND (il.fecha_vencimiento IS NULL OR il.fecha_vencimiento >= CURRENT_DATE)
      AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
      AND (v_item.talle IS NULL OR il.talle = v_item.talle)
      AND (v_item.color IS NULL OR il.color = v_item.color)
      AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
      AND (v_item.formato IS NULL OR il.formato = v_item.formato)
      AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
      AND EXISTS (SELECT 1 FROM ubicaciones u3 WHERE u3.id = il.ubicacion_id AND u3.disponible_surtido IS NOT FALSE)
      AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0;

    IF v_disponible < v_item.pendiente THEN
      SELECT p.nombre, p.sku INTO v_producto FROM productos p WHERE p.id = v_item.producto_id;
      RAISE EXCEPTION 'No hay stock para % (SKU %) — faltan % unidades',
        v_producto.nombre, v_producto.sku, (v_item.pendiente - v_disponible);
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    v_pendiente := v_item.pendiente;
    CONTINUE WHEN v_pendiente <= 0;

    FOR v_linea IN
      SELECT il.id, il.cantidad, COALESCE(il.cantidad_reservada,0) AS cantidad_reservada, il.ubicacion_id, il.lpn
      FROM inventario_lineas il
      WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
        AND il.activo = true AND il.ubicacion_id IS NOT NULL
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        AND (il.fecha_vencimiento IS NULL OR il.fecha_vencimiento >= CURRENT_DATE)
        AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
        AND (v_item.talle IS NULL OR il.talle = v_item.talle)
        AND (v_item.color IS NULL OR il.color = v_item.color)
        AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
        AND (v_item.formato IS NULL OR il.formato = v_item.formato)
        AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
        AND EXISTS (SELECT 1 FROM ubicaciones u3 WHERE u3.id = il.ubicacion_id AND u3.disponible_surtido IS NOT FALSE)
        AND (il.cantidad - COALESCE(il.cantidad_reservada,0)) > 0
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE OF il SKIP LOCKED
    LOOP
      EXIT WHEN v_pendiente <= 0;
      v_tomar := LEAST(v_pendiente, v_linea.cantidad - v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      UPDATE inventario_lineas SET cantidad_reservada = cantidad_reservada + v_tomar WHERE id = v_linea.id;

      SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_linea.ubicacion_id;

      IF v_linea.ubicacion_id IS NOT NULL AND v_ubic_tipo = 'picking' THEN
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_linea.lpn, 'pedido', p_pedido_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSIF v_reab_on THEN
        v_destino_id := fn_wms_elegir_ubicacion_picking(v_pedido.tenant_id, v_pedido.sucursal_id, v_item.producto_id);
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, ubicacion_destino_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'replenishment', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_destino_id, v_linea.lpn, 'pedido', p_pedido_id,
                'Reabastecer ' || fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer) || ' a zona de picking')
        RETURNING id INTO v_reab_id;
        RETURN QUERY SELECT v_reab_id, 'replenishment'::text;

        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, tarea_precedente_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, COALESCE(v_destino_id, v_linea.ubicacion_id), v_linea.lpn, 'pedido', p_pedido_id, v_reab_id,
                fn_wms_describir_cantidad(v_item.producto_id, v_tomar::integer))
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;

      ELSE
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_tomar, v_linea.ubicacion_id, v_linea.lpn, 'pedido', p_pedido_id,
                'Ubicación fuera de zona picking — reabastecimiento on-demand deshabilitado')
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;
      END IF;

      v_pendiente := v_pendiente - v_tomar;
    END LOOP;

    IF v_pendiente > 0 THEN
      SELECT p.nombre, p.sku INTO v_producto FROM productos p WHERE p.id = v_item.producto_id;
      RAISE EXCEPTION 'No hay stock para % (SKU %) — faltan % unidades (cambió mientras se lanzaba, reintentá)',
        v_producto.nombre, v_producto.sku, v_pendiente;
    END IF;
  END LOOP;

  IF v_pedido.requiere_envio AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = p_pedido_id) THEN
    v_domicilio_id := NULL;
    IF v_pedido.cliente_id IS NOT NULL THEN
      SELECT cd.id INTO v_domicilio_id FROM cliente_domicilios cd
      WHERE cd.cliente_id = v_pedido.cliente_id
      ORDER BY cd.es_principal DESC, cd.created_at
      LIMIT 1;
    END IF;
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, destino_id, canal, estado, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_domicilio_id, 'Pedidos', 'pendiente',
            'Generado automáticamente al lanzar el Pedido #' || v_pedido.numero);
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid() WHERE id = p_pedido_id;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_stock(uuid) IS
  'Mig 334: chequeo de zona de picking usa tipo_logico en vez de tipo_ubicacion. Sin cambios de comportamiento.';

CREATE OR REPLACE FUNCTION public.fn_generar_tareas_picking_pedido_venta(p_pedido_id uuid)
RETURNS TABLE (tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD; v_item RECORD; v_fuente RECORD; v_pick_id uuid;
  v_ubic_tipo text; v_domicilio_id uuid; v_pendiente numeric; v_hubo boolean;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;
  IF v_pedido.venta_origen_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido no nació de una venta — usá fn_generar_tareas_picking_pedido';
  END IF;
  IF EXISTS (SELECT 1 FROM wms_tareas WHERE pedido_id = p_pedido_id) THEN
    RETURN QUERY SELECT wt.id, wt.tipo FROM wms_tareas wt WHERE wt.pedido_id = p_pedido_id;
    RETURN;
  END IF;
  IF v_pedido.estado = 'cancelado' THEN RAISE EXCEPTION 'El pedido está cancelado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Confirmá el pedido antes de lanzarlo'; END IF;

  FOR v_item IN
    SELECT pi.producto_id, (pi.cantidad - pi.cantidad_entregada) AS cantidad
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
      AND (pi.cantidad - pi.cantidad_entregada) > 0
  LOOP
    v_pendiente := v_item.cantidad;
    v_hubo := false;

    FOR v_fuente IN
      SELECT vid.lpn, vid.ubicacion_id, SUM(vid.cantidad) AS cantidad, 1 AS prio
      FROM venta_item_despachos vid
      WHERE vid.venta_id = v_pedido.venta_origen_id AND vid.producto_id = v_item.producto_id
        AND vid.cantidad > 0
      GROUP BY vid.lpn, vid.ubicacion_id
      UNION ALL
      SELECT il.lpn, il.ubicacion_id, SUM((p->>'cantidad')::numeric) AS cantidad, 2 AS prio
      FROM venta_items vi
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(vi.lpn_plan, '[]'::jsonb)) p
      JOIN inventario_lineas il ON il.id = (p->>'linea_id')::uuid
      WHERE vi.venta_id = v_pedido.venta_origen_id AND vi.producto_id = v_item.producto_id
        AND NOT EXISTS (SELECT 1 FROM venta_item_despachos d
                        WHERE d.venta_id = v_pedido.venta_origen_id AND d.producto_id = v_item.producto_id)
        AND (p->>'cantidad')::numeric > 0
      GROUP BY il.lpn, il.ubicacion_id
      ORDER BY prio
    LOOP
      EXIT WHEN v_pendiente <= 0;
      SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                              ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id,
              LEAST(v_fuente.cantidad, v_pendiente), v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_item.producto_id, LEAST(v_fuente.cantidad, v_pendiente)::integer)
                || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ' — fuera de zona de picking' ELSE '' END)
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
      v_pendiente := v_pendiente - LEAST(v_fuente.cantidad, v_pendiente);
      v_hubo := true;
    END LOOP;

    IF v_pendiente > 0 THEN
      FOR v_fuente IN
        SELECT il.lpn, il.ubicacion_id, il.cantidad,
               (CASE WHEN COALESCE(il.cantidad_reservada,0) > 0 THEN 3 ELSE 4 END) AS prio
        FROM inventario_lineas il
        WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
          AND il.activo = true AND il.cantidad > 0
          AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        ORDER BY prio, il.fecha_vencimiento NULLS LAST, il.created_at
      LOOP
        EXIT WHEN v_pendiente <= 0;
        SELECT u.tipo_logico INTO v_ubic_tipo FROM ubicaciones u WHERE u.id = v_fuente.ubicacion_id;
        INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad,
                                ubicacion_origen_id, lpn_origen, origen, pedido_id, notas)
        VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id,
                LEAST(v_fuente.cantidad, v_pendiente), v_fuente.ubicacion_id, v_fuente.lpn, 'pedido', p_pedido_id,
                fn_wms_describir_cantidad(v_item.producto_id, LEAST(v_fuente.cantidad, v_pendiente)::integer)
                  || CASE WHEN v_fuente.prio = 3 THEN ' — LPN sugerido (la venta reservó acá)'
                          ELSE ' — LPN sugerido por FEFO' END
                  || CASE WHEN v_ubic_tipo IS DISTINCT FROM 'picking' THEN ', fuera de zona de picking' ELSE '' END)
        RETURNING id INTO v_pick_id;
        RETURN QUERY SELECT v_pick_id, 'picking'::text;
        v_pendiente := v_pendiente - LEAST(v_fuente.cantidad, v_pendiente);
        v_hubo := true;
      END LOOP;
    END IF;

    IF NOT v_hubo THEN
      INSERT INTO wms_tareas (tenant_id, sucursal_id, tipo, producto_id, cantidad, origen, pedido_id, notas)
      VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, 'picking', v_item.producto_id, v_item.cantidad,
              'pedido', p_pedido_id,
              fn_wms_describir_cantidad(v_item.producto_id, v_item.cantidad::integer)
                || ' — ⚠ sin stock ubicado para este producto')
      RETURNING id INTO v_pick_id;
      RETURN QUERY SELECT v_pick_id, 'picking'::text;
    END IF;
  END LOOP;

  IF v_pedido.requiere_envio
     AND NOT EXISTS (SELECT 1 FROM envios WHERE pedido_id = p_pedido_id)
     AND NOT EXISTS (SELECT 1 FROM envios WHERE venta_id = v_pedido.venta_origen_id) THEN
    v_domicilio_id := NULL;
    IF v_pedido.cliente_id IS NOT NULL THEN
      SELECT cd.id INTO v_domicilio_id FROM cliente_domicilios cd
      WHERE cd.cliente_id = v_pedido.cliente_id
      ORDER BY cd.es_principal DESC, cd.created_at LIMIT 1;
    END IF;
    INSERT INTO envios (tenant_id, sucursal_id, pedido_id, venta_id, destino_id, canal, estado, notas)
    VALUES (v_pedido.tenant_id, v_pedido.sucursal_id, p_pedido_id, v_pedido.venta_origen_id,
            v_domicilio_id, 'Pedidos', 'pendiente',
            'Generado automáticamente al lanzar el Pedido #' || v_pedido.numero);
  END IF;

  UPDATE pedidos SET estado = 'en_preparacion', lanzado_at = now(), lanzado_por = auth.uid()
  WHERE id = p_pedido_id;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_generar_tareas_picking_pedido_venta(uuid) IS
  'Mig 334: chequeo de zona de picking usa tipo_logico en vez de tipo_ubicacion. Sin cambios de comportamiento.';

CREATE OR REPLACE FUNCTION public.fn_lanzar_bolsa_pedidos(p_pedido_ids uuid[], p_ubicacion_staging_id uuid)
RETURNS TABLE (pedido_id uuid, tarea_id uuid, tipo text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primer_pedido   RECORD;
  v_ubicacion       RECORD;
  v_lanzamiento_id  uuid;
  v_pedido_id       uuid;
  v_pedido_tid      uuid;
  v_row             RECORD;
BEGIN
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Elegí al menos un pedido para lanzar en bolsa';
  END IF;
  IF p_ubicacion_staging_id IS NULL THEN
    RAISE EXCEPTION 'Elegí una ubicación de staging para la bolsa';
  END IF;

  SELECT * INTO v_primer_pedido FROM pedidos WHERE id = p_pedido_ids[1];
  IF v_primer_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  SELECT * INTO v_ubicacion FROM ubicaciones
  WHERE id = p_ubicacion_staging_id AND tenant_id = v_primer_pedido.tenant_id;
  IF v_ubicacion IS NULL THEN
    RAISE EXCEPTION 'Ubicación de staging inexistente o de otro tenant';
  END IF;
  IF v_ubicacion.subtipo_almacenamiento IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'La ubicación elegida no es de tipo staging';
  END IF;
  IF NOT COALESCE(v_ubicacion.activo, true) THEN
    RAISE EXCEPTION 'La ubicación de staging elegida está desactivada';
  END IF;

  FOREACH v_pedido_id IN ARRAY p_pedido_ids LOOP
    SELECT tenant_id INTO v_pedido_tid FROM pedidos WHERE id = v_pedido_id;
    IF v_pedido_tid IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos: %', v_pedido_id; END IF;
    IF v_pedido_tid IS DISTINCT FROM v_primer_pedido.tenant_id THEN
      RAISE EXCEPTION 'Todos los pedidos de la bolsa tienen que ser del mismo tenant';
    END IF;
    IF EXISTS (SELECT 1 FROM wms_tareas WHERE wms_tareas.pedido_id = v_pedido_id) THEN
      RAISE EXCEPTION 'El pedido % ya fue lanzado — no se puede incluir en una bolsa nueva', v_pedido_id;
    END IF;
  END LOOP;

  INSERT INTO pedido_lanzamientos (tenant_id, sucursal_id, ubicacion_staging_id, creado_por)
  VALUES (v_primer_pedido.tenant_id, v_primer_pedido.sucursal_id, p_ubicacion_staging_id, auth.uid())
  RETURNING id INTO v_lanzamiento_id;

  FOREACH v_pedido_id IN ARRAY p_pedido_ids LOOP
    FOR v_row IN SELECT * FROM fn_generar_tareas_picking_pedido(v_pedido_id) LOOP
      UPDATE wms_tareas SET lanzamiento_id = v_lanzamiento_id WHERE id = v_row.tarea_id;
      RETURN QUERY SELECT v_pedido_id, v_row.tarea_id, v_row.tipo;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_lanzar_bolsa_pedidos(uuid[], uuid) IS
  'Mig 334: valida subtipo_almacenamiento=''staging'' en vez de tipo_ubicacion=''staging'', con IS DISTINCT FROM (corrige un bug latente: el <> viejo no rechazaba una ubicación con tipo NULL). Sin otros cambios de comportamiento.';

-- ============================================================
-- 335_producto_ubicacion_exhibicion.sql (idéntico, nunca aplicado en PROD)
-- ============================================================

-- ============================================================
-- 335_producto_ubicacion_exhibicion.sql
-- FASE U2 del rediseño de Ubicaciones (relevamiento 2026-08-02, respuestas de Fede+GO
-- 2026-08-05, sección C — ubicación única y obligatoria de exhibición por SKU).
--
-- ── Columna NUEVA, no se reinterpreta la que ya existe ──────────────────────────────────
-- El relevamiento (C1) pedía reusar producto_ubicacion_sucursal, dejando a criterio técnico
-- si conviene. La columna actual `ubicacion_id` es hoy un DEFAULT de PUTAWAY (dónde guardar
-- al recibir, cualquier tipo de ubicación) leído por 3 pantallas (ProductoFormPage,
-- InventarioPage/resolverUbicacionDefault, RecepcionesPage) — nunca obligatorio, nunca
-- ligado a exhibición. La ubicación de EXHIBICIÓN (dónde el cliente ve/busca el producto,
-- que Repositores va a necesitar) es una pregunta de negocio distinta que puede
-- legítimamente responderse distinto (ej. el default de recepción es un estante de
-- depósito, la exhibición es una góndola distinta) — pisar `ubicacion_id` con ese segundo
-- significado rompería el uso actual de los 3 archivos que ya la leen. Se reusa la TABLA
-- (no se crea una nueva), se agrega una columna.
--
-- C2 (¿apunta a la contenedora o a un nivel específico?) queda resuelto sin columna extra:
-- es "configurable" por construcción, porque ubicacion_exhibicion_id es un FK plano a
-- ubicaciones.id — con el árbol de la mig 334, esa fila puede ser tanto una contenedora
-- (padre_ubicacion_id NULL) como un nivel específico, según qué tan preciso quiera ser cada
-- usuario. No hace falta modelar los dos casos por separado.
--
-- Sin obligatoriedad a nivel DB: "obligatorio para productos de Góndola" es una regla de
-- negocio CONDICIONAL (solo aplica si el producto se vende por exhibición), no un NOT NULL
-- de la tabla — queda para un guard de UI/RPC en la fase que construya el flujo de
-- Repositores, no bloqueante acá.
-- ============================================================

ALTER TABLE producto_ubicacion_sucursal
  ADD COLUMN IF NOT EXISTS ubicacion_exhibicion_id uuid REFERENCES ubicaciones(id) ON DELETE SET NULL;

COMMENT ON COLUMN producto_ubicacion_sucursal.ubicacion_exhibicion_id IS
  'Ubicación de EXHIBICIÓN del SKU en esta sucursal (mig 335, relevamiento Ubicaciones sección C) — de cara al cliente, la usa Repositores. Distinta de ubicacion_id (default de PUTAWAY al recibir, sin relación con exhibición). Puede apuntar a una contenedora o a un nivel específico del árbol (mig 334) — configurable por el usuario, sin obligatoriedad a nivel DB (la obligatoriedad para productos de Góndola es una regla condicional de UI/RPC, no de esquema).';
