-- ============================================================
-- 309_variantes_stock_sin_asignar.sql
-- FASE 4 del rediseño UoM/Empaque/Variantes (ver diseño-uom-empaque-variantes.html §7).
--
-- 🛑 REGLA #0 (INVENTARIO): esta migración mueve STOCK entre SKUs. Todo lo que se mueve queda
-- trazado en `movimientos_stock` (par salida/entrada, neto CERO) y nunca se pierde ni se duplica
-- una unidad. Toda la reasignación corre dentro de UNA función (= una transacción) con las líneas
-- bloqueadas `FOR UPDATE`.
--
-- Tres cosas:
--
--  A) Stock "SIN VARIANTE ASIGNADA" + reasignación.
--     Hoy la UI BLOQUEA crear la 1ra variante de un producto standalone que tiene stock (mig 305
--     no tocó stock). A partir de acá se permite: el stock viejo queda colgando de la MADRE, que
--     ya no es vendible (el POS excluye a las madres con hijos desde la Fase 3) → es stock
--     visible y contable pero NO vendible. `fn_reasignar_stock_variante` lo reparte a los hijos.
--
--  B) Guard de borrado multi-sucursal: `fn_stock_por_sucursal` para que el cartel NOMBRE la
--     sucursal que tiene stock (hoy el mensaje es un genérico "tiene actividad"). El BLOQUEO en sí
--     ya existe server-side (`fn_producto_tiene_actividad` chequea `inventario_lineas`); esto NO lo
--     debilita, solo lo explica.
--
--  C) E3 — cambio de unidad de medida física: dentro de la MISMA familia es libre (el stock se
--     guarda en la unidad atómica de la familia, así que cambiar kg↔g no reinterpreta nada);
--     CRUZAR de familia con stock ≠ 0 se bloquea (no existe conversión peso↔volumen).
--
-- Tipo de movimiento NUEVO: 'reasignacion_variante'.
--   ⚠ NO se reusó 'ajuste_rebaje' a propósito: el Dashboard de Inventario cuenta los
--   `ajuste_rebaje` del mes como MERMAS (DashInventarioArea.tsx) — reasignar stock entre variantes
--   habría inflado la merma con una pérdida que no existió (métrica de plata falseada).
--   El tipo nuevo no matchea ningún filtro de KPI (mermas, rotación, runway) → queda fuera de
--   todos ellos, que es lo correcto: el neto de la operación es cero.
-- ============================================================

-- ── 1) Nuevo tipo de movimiento ─────────────────────────────────────────────────────────
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'ingreso', 'rebaje', 'ajuste', 'kitting', 'des_kitting',
    'ajuste_ingreso', 'ajuste_rebaje', 'traslado',
    'reasignacion_variante'
  ]));

COMMENT ON CONSTRAINT movimientos_stock_tipo_check ON movimientos_stock IS
  'reasignacion_variante (mig 309): mueve stock de una madre agrupadora a sus variantes hijo. Siempre en PARES (salida de la madre + entrada del hijo, misma cantidad) → neto cero. No es merma ni ajuste: se excluye a propósito de los KPI de merma/rotación.';

-- ── 2) Reasignar el stock "sin variante asignada" de una madre a sus hijos ───────────────
-- p_asignaciones: [{"linea_id": uuid, "hijo_id": uuid, "cantidad": int}, ...]
--   · Varias entradas pueden apuntar a la MISMA línea (repartir un LPN entre varios hijos).
--   · Si a una línea se le asigna TODA su cantidad a UN solo hijo → se RE-APUNTA la línea
--     (`producto_id = hijo`): es la misma caja física, conserva su LPN y su etiqueta. El trigger
--     `lineas_recalcular_stock` ya contempla el cambio de producto_id y recalcula AMBOS productos.
--   · Si es parcial (o la línea se reparte entre varios hijos) → se descuenta de la línea origen
--     y se CREA una línea nueva para el hijo, heredando ubicación/estado/lote/vencimiento/costo.
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
BEGIN
  -- ── Autorización (SECURITY DEFINER bypassea RLS: el chequeo de tenant es explícito) ──
  SELECT tenant_id INTO v_caller_tenant FROM users WHERE id = auth.uid();
  IF v_caller_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant';
  END IF;

  SELECT id, tenant_id, nombre, tiene_series INTO v_madre
  FROM productos WHERE id = p_madre_id;
  IF v_madre.id IS NULL THEN
    RAISE EXCEPTION 'El producto no existe';
  END IF;
  IF v_madre.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM productos WHERE producto_padre_id = p_madre_id) THEN
    RAISE EXCEPTION '"%" no tiene variantes: no hay a quién reasignarle el stock', v_madre.nombre;
  END IF;

  -- Serializados: cada unidad es un número de serie concreto; repartir "6 y 4" sin decir QUÉ
  -- series van a cada hijo rompería la trazabilidad (Regla #0). Queda para una fase posterior.
  IF COALESCE(v_madre.tiene_series, false) THEN
    RAISE EXCEPTION 'Los productos con número de serie todavía no se pueden reasignar automáticamente: hay que elegir qué serie va a cada variante';
  END IF;

  IF p_asignaciones IS NULL OR jsonb_typeof(p_asignaciones) <> 'array'
     OR jsonb_array_length(p_asignaciones) = 0 THEN
    RAISE EXCEPTION 'No se recibió ninguna asignación';
  END IF;

  -- ── PASO 1: validar TODO antes de mover nada (y bloquear las líneas) ──────────────────
  FOR v_chk IN
    SELECT a.linea_id, sum(a.cantidad)::int AS total
    FROM (
      SELECT (e->>'linea_id')::uuid AS linea_id, (e->>'cantidad')::int AS cantidad
      FROM jsonb_array_elements(p_asignaciones) e
    ) a
    GROUP BY a.linea_id
    ORDER BY a.linea_id   -- orden de locking determinístico: dos reasignaciones concurrentes que
                          -- se solapan hacen cola en vez de deadlockear
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
    -- Reservado = comprometido con un pedido/picking en curso. Moverlo dejaría la reserva
    -- apuntando a un producto que ya no es el de la línea.
    IF COALESCE(v_linea.cantidad_reservada, 0) > 0 THEN
      RAISE EXCEPTION 'La línea % tiene % unidad(es) reservadas para un pedido: liberá la reserva antes de reasignar',
        v_linea.lpn, v_linea.cantidad_reservada;
    END IF;
    -- LPN madre (con LPN hijos colgando): mover el contenedor rompería la jerarquía física.
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
    IF v_chk.total > v_linea.cantidad THEN
      RAISE EXCEPTION 'La línea % tiene % unidades y se intentan reasignar %',
        v_linea.lpn, v_linea.cantidad, v_chk.total;
    END IF;

    v_total_lineas := v_total_lineas + 1;
  END LOOP;

  -- Validar los hijos destino (una sola vez por hijo)
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
    IF EXISTS (SELECT 1 FROM productos h WHERE h.id = v_hijo.hijo_id AND h.tiene_series) THEN
      RAISE EXCEPTION 'La variante destino maneja números de serie: no se puede reasignar automáticamente';
    END IF;
  END LOOP;

  -- ── PASO 2: aplicar ───────────────────────────────────────────────────────────────────
  FOR v_asig IN
    SELECT (e->>'linea_id')::uuid AS linea_id,
           (e->>'hijo_id')::uuid  AS hijo_id,
           (e->>'cantidad')::int  AS cantidad,
           -- ¿esta línea se va ENTERA a este único hijo? → se re-apunta en vez de partirse
           (SELECT count(*) FROM jsonb_array_elements(p_asignaciones) e2
             WHERE (e2->>'linea_id')::uuid = (e->>'linea_id')::uuid) AS destinos_de_la_linea
    FROM jsonb_array_elements(p_asignaciones) e
  LOOP
    IF v_asig.cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida';
    END IF;

    SELECT * INTO v_linea FROM inventario_lineas WHERE id = v_asig.linea_id;

    SELECT stock_actual INTO v_madre_antes FROM productos WHERE id = p_madre_id;
    SELECT stock_actual INTO v_hijo_antes  FROM productos WHERE id = v_asig.hijo_id;

    IF v_asig.destinos_de_la_linea = 1 AND v_asig.cantidad = v_linea.cantidad THEN
      -- Misma caja física, ahora correctamente identificada: conserva LPN, ubicación y lote.
      -- `estructura_id` apuntaba a una estructura de la MADRE → se limpia (el hijo tiene la suya).
      UPDATE inventario_lineas
        SET producto_id = v_asig.hijo_id, estructura_id = NULL, updated_at = now()
        WHERE id = v_asig.linea_id;
      v_dest_linea := v_asig.linea_id;
    ELSE
      -- Parcial: se descuenta del origen y nace una línea nueva para el hijo.
      -- `activo` sigue el patrón del resto del sistema (rebaje FIFO): un LPN que queda en 0 se
      -- desactiva, para que ningún picker/listado lo muestre como disponible.
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
        -- `parent_lpn_id`: la porción nueva sigue físicamente DENTRO del mismo contenedor
        v_linea.notas, v_linea.pais_origen, v_linea.parent_lpn_id,
        v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma
      ) RETURNING id INTO v_dest_linea;
      -- `unidad_medida_id`/`cantidad_uom` NO se copian: describen el empaque con el que ENTRÓ ese
      -- LPN completo; en una línea partida el número dejaría de ser cierto.
    END IF;

    SELECT stock_actual INTO v_madre_desp FROM productos WHERE id = p_madre_id;
    SELECT stock_actual INTO v_hijo_desp  FROM productos WHERE id = v_asig.hijo_id;

    -- Par de movimientos: salida de la madre + entrada del hijo (neto CERO, trazado).
    INSERT INTO movimientos_stock (
      tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues,
      motivo, sucursal_id, linea_id, usuario_id
    ) VALUES (
      v_caller_tenant, p_madre_id, 'reasignacion_variante', v_asig.cantidad, v_madre_antes, v_madre_desp,
      'Reasignación de stock sin variante asignada → ' ||
        COALESCE((SELECT variante_diferenciador FROM productos WHERE id = v_asig.hijo_id), 'variante') ||
        ' (LPN ' || v_linea.lpn || ')',
      v_linea.sucursal_id, v_asig.linea_id, auth.uid()
    );

    INSERT INTO movimientos_stock (
      tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues,
      motivo, sucursal_id, linea_id, usuario_id
    ) VALUES (
      v_caller_tenant, v_asig.hijo_id, 'reasignacion_variante', v_asig.cantidad, v_hijo_antes, v_hijo_desp,
      'Stock recibido de "' || v_madre.nombre || '" (sin variante asignada, LPN ' || v_linea.lpn || ')',
      v_linea.sucursal_id, v_dest_linea, auth.uid()
    );

    v_total_unid := v_total_unid + v_asig.cantidad;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'unidades_reasignadas', v_total_unid,
    'lineas_afectadas', v_total_lineas,
    'stock_sin_asignar_restante', (SELECT stock_actual FROM productos WHERE id = p_madre_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reasignar_stock_variante(uuid, jsonb) IS
  'Fase 4 del rediseño UoM: reparte el stock "sin variante asignada" de una madre agrupadora entre sus variantes hijo. Atómica, con las líneas bloqueadas FOR UPDATE y un par de movimientos_stock (neto cero) por asignación.';

-- ── 3) Desglose de stock por sucursal (para que el cartel de borrado NOMBRE la sucursal) ──
CREATE OR REPLACE FUNCTION public.fn_stock_por_sucursal(p_producto_ids uuid[])
RETURNS TABLE(
  producto_id      uuid,
  producto_nombre  text,
  sucursal_id      uuid,
  sucursal_nombre  text,
  cantidad         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant uuid;
BEGIN
  SELECT u.tenant_id INTO v_caller_tenant FROM users u WHERE u.id = auth.uid();
  IF v_caller_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant';
  END IF;

  RETURN QUERY
  SELECT il.producto_id,
         p.nombre,
         il.sucursal_id,
         COALESCE(s.nombre, 'Sin sucursal'),
         sum(il.cantidad)::bigint
  FROM inventario_lineas il
  JOIN productos p ON p.id = il.producto_id
  LEFT JOIN sucursales s ON s.id = il.sucursal_id
  WHERE il.producto_id = ANY(p_producto_ids)
    AND il.tenant_id = v_caller_tenant      -- nunca filtrar stock de otro tenant
    AND COALESCE(il.activo, true)
  GROUP BY il.producto_id, p.nombre, il.sucursal_id, s.nombre
  HAVING sum(il.cantidad) > 0
  ORDER BY p.nombre, COALESCE(s.nombre, 'Sin sucursal');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_stock_por_sucursal(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_stock_por_sucursal(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_stock_por_sucursal(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_stock_por_sucursal(uuid[]) IS
  'Fase 4 del rediseño UoM: desglose de stock por sucursal de una lista de productos (solo del tenant del que llama). Se usa para que el cartel de "no se puede borrar" nombre la/las sucursal(es) con stock, en vez del genérico "tiene actividad".';

-- ── 4) E3 — cambio de unidad de medida física ────────────────────────────────────────────
-- Misma familia (kg ↔ g): LIBRE. El stock se guarda en la unidad atómica de la familia, así que
-- cambiar la unidad de la ficha es solo cambiar cómo se MUESTRA — no reinterpreta ninguna cantidad.
-- Cruzar de familia (kg → litros) con stock: BLOQUEADO. No existe conversión universal peso↔volumen,
-- así que las cantidades guardadas pasarían a significar otra cosa (Regla #0: inventario).
CREATE OR REPLACE FUNCTION public.trg_producto_udm_cambio_familia()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fam_old  text;
  v_fam_new  text;
  v_nom_old  text;
  v_nom_new  text;
  v_con_stock boolean;
BEGIN
  IF NEW.unidad_medida_base_id IS NOT DISTINCT FROM OLD.unidad_medida_base_id THEN
    RETURN NEW;
  END IF;
  -- Pasar de "sin unidad" a una unidad (o viceversa) no reinterpreta cantidades: es completar la ficha.
  IF OLD.unidad_medida_base_id IS NULL OR NEW.unidad_medida_base_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT familia, nombre INTO v_fam_old, v_nom_old
  FROM unidades_medida_fisicas WHERE id = OLD.unidad_medida_base_id;
  SELECT familia, nombre INTO v_fam_new, v_nom_new
  FROM unidades_medida_fisicas WHERE id = NEW.unidad_medida_base_id;

  IF v_fam_old IS NULL OR v_fam_new IS NULL OR v_fam_old = v_fam_new THEN
    RETURN NEW;   -- misma familia (o unidad desconocida): libre
  END IF;

  SELECT COALESCE(OLD.stock_actual, 0) <> 0
         OR EXISTS (SELECT 1 FROM inventario_lineas il
                    WHERE il.producto_id = NEW.id AND COALESCE(il.activo, true) AND il.cantidad <> 0)
    INTO v_con_stock;

  IF v_con_stock THEN
    RAISE EXCEPTION 'No se puede cambiar la unidad de medida de % (%) a % (%) porque el producto tiene stock: no hay conversión entre esas familias. Dejá el stock en 0 o creá un producto nuevo.',
      v_nom_old, v_fam_old, v_nom_new, v_fam_new;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_udm_familia ON productos;
CREATE TRIGGER trg_productos_udm_familia
  BEFORE UPDATE OF unidad_medida_base_id ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_producto_udm_cambio_familia();

-- ── 5) 🛑 Sync de marketplaces cuando una LÍNEA CAMBIA DE PRODUCTO ───────────────────────
-- Bug latente que destapó la reasignación (`producto_id` de una línea nunca había cambiado
-- antes en la práctica):
--   · TiendaNube: `trg_tn_stock_sync` estaba acotado a `UPDATE OF cantidad, cantidad_reservada,
--     activo` → un re-apuntado de línea NO disparaba el trigger, y NI la madre (que bajó) NI el
--     hijo (que subió) se sincronizaban.
--   · MercadoLibre: el trigger sí dispara, pero la función solo encolaba `NEW.producto_id` → el
--     lado de la MADRE (el que bajó a 0) nunca se sincronizaba.
-- En ambos casos el listado publicado quedaba con stock viejo → riesgo de SOBREVENTA (Regla #0).
-- Las dos funciones pasan a encolar AMBOS productos cuando `producto_id` cambia.

CREATE OR REPLACE FUNCTION public.fn_enqueue_meli_stock_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_ids         uuid[];
  v_producto_id uuid;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF v_tenant_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_ids := ARRAY[COALESCE(NEW.producto_id, OLD.producto_id)];
  -- Una línea reasignada a otro SKU baja el stock del producto viejo: hay que sincronizarlo también.
  IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id
     AND OLD.producto_id IS NOT NULL THEN
    v_ids := v_ids || OLD.producto_id;
  END IF;

  FOREACH v_producto_id IN ARRAY v_ids LOOP
    CONTINUE WHEN v_producto_id IS NULL;
    INSERT INTO integration_job_queue (tenant_id, integracion, tipo, payload, status, next_attempt_at)
    SELECT v_tenant_id, 'MercadoLibre', 'sync_stock',
           jsonb_build_object('producto_id', v_producto_id, 'meli_item_id', meli_item_id, 'meli_variation_id', meli_variation_id),
           'pending', NOW()
    FROM inventario_meli_map
    WHERE tenant_id = v_tenant_id AND producto_id = v_producto_id AND sync_stock = TRUE
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_tn_stock_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id   uuid;
  v_ids         uuid[];
  v_producto_id uuid;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF v_tenant_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_ids := ARRAY[COALESCE(NEW.producto_id, OLD.producto_id)];
  IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id
     AND OLD.producto_id IS NOT NULL THEN
    v_ids := v_ids || OLD.producto_id;
  END IF;

  FOREACH v_producto_id IN ARRAY v_ids LOOP
    CONTINUE WHEN v_producto_id IS NULL;
    -- Un job pendiente por producto alcanza (el worker lee el stock actual al ejecutarse).
    INSERT INTO integration_job_queue (tenant_id, sucursal_id, integracion, tipo, payload, next_attempt_at)
    SELECT itm.tenant_id, itm.sucursal_id, 'TiendaNube', 'sync_stock',
           jsonb_build_object(
             'producto_id',   v_producto_id::text,
             'tn_product_id', itm.tn_product_id,
             'tn_variant_id', itm.tn_variant_id
           ),
           NOW()
    FROM inventario_tn_map itm
    WHERE itm.producto_id = v_producto_id
      AND itm.tenant_id   = v_tenant_id
      AND itm.sync_stock  = true
      AND NOT EXISTS (
        SELECT 1 FROM integration_job_queue q
        WHERE q.tenant_id    = itm.tenant_id
          AND q.integracion  = 'TiendaNube'
          AND q.tipo         = 'sync_stock'
          AND q.status       = 'pending'
          AND q.payload->>'producto_id' = v_producto_id::text
      );
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- El trigger de TN tiene que escuchar también el cambio de `producto_id` (antes no estaba en la lista).
DROP TRIGGER IF EXISTS trg_tn_stock_sync ON inventario_lineas;
CREATE TRIGGER trg_tn_stock_sync
  AFTER INSERT OR DELETE OR UPDATE OF cantidad, cantidad_reservada, activo, producto_id
  ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_tn_stock_sync();
