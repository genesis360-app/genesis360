-- ============================================================
-- 326_picking_prefiere_ubicacion_con_lugar.sql
-- 📦 CUBICAJE — paso 4: al reabastecer, elegir una posición de picking que TENGA LUGAR.
--
-- `fn_wms_elegir_ubicacion_picking` (mig 290) elige el destino de una tarea de reabastecimiento
-- (bulk → picking) mirando solo si la posición ya tiene stock de ese producto, y después secuencia
-- y prioridad. **Nunca miraba la ocupación**, así que podía mandar mercadería a una posición que ya
-- está al tope de LPN, de peso o de espacio — el operario llega con el pallet y no entra.
-- Ahora que `vw_ubicacion_ocupacion` calcula los tres (migs 321/322/325), se puede.
--
-- 🛑 Dos invariantes que NO se pueden romper acá (Regla #0 inventario):
--
-- 1. **La capacidad DESEMPATA, no EXCLUYE.** Si todas las posiciones de picking están llenas, la
--    función tiene que seguir devolviendo una. Filtrar las llenas dejaría la tarea de
--    reabastecimiento **sin destino** y el stock nunca llegaría al picking — un dato de
--    configuración cargado a mano (que puede estar viejo o mal) frenando mercadería real. Es el
--    mismo criterio que la UI: **avisa, no bloquea**.
--
-- 2. **Sin capacidad configurada, nada cambia.** "Sin lugar" exige un tope CONFIGURADO y ALCANZADO.
--    Un campo vacío significa "no sé", y no sé nunca puede degradar a una posición: si no, todos los
--    tenants que no cargaron capacidad (la enorme mayoría) verían su orden de picking reordenado en
--    silencio por este deploy.
--
-- El orden queda: (a) ya tiene stock del producto Y tiene lugar · (b) ya tiene stock aunque esté
-- llena — mantiene el SKU consolidado en su cara de picking, que es lo que venía haciendo ·
-- (c) tiene lugar · (d) el resto. Después, la secuencia de recorrido y la prioridad de siempre.
--
-- 📌 Dos notas del `migration-reviewer`, aceptadas a propósito:
--
--  · **El desempate final por `u.id` es NUEVO.** La 290 terminaba en `secuencia, prioridad`, y
--    Postgres no garantiza un sort estable: entre dos posiciones empatadas podía devolver una
--    distinta en cada llamada y mandar el mismo SKU a dos caras de picking en reabastecimientos
--    seguidos. Se agrega a sabiendas de que, para ese empate, la elegida puede no ser la misma que
--    antes — nunca hubo garantía de cuál era.
--
--  · **Costo del JOIN a `vw_ubicacion_ocupacion`**, que es una vista agregada y esta función se
--    llama UNA VEZ POR ÍTEM al lanzar un pedido o generar el picking de un envío. Lo que lo acota
--    es que la vista es `security_invoker` y estas RPCs son `SECURITY INVOKER`: la RLS de
--    `inventario_lineas` se aplica ADENTRO, así que el agregado nunca recorre más que las líneas
--    del propio tenant. Aun así **queda pendiente correr `EXPLAIN ANALYZE` contra un tenant con
--    volumen real** antes de darlo por barato; si molestara, la salida es snapshotear la ocupación
--    una vez por llamada al generador de tareas, no por ítem (fuera del alcance de esta migración).
-- ============================================================

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
  -- LEFT JOIN y no CROSS/INNER: si por lo que sea no se resuelve la config del tenant o la
  -- ocupación, la ubicación tiene que seguir siendo candidata (invariante 1).
  LEFT JOIN tenants t
    ON t.id = p_tenant_id
  LEFT JOIN vw_ubicacion_ocupacion oc
    ON oc.ubicacion_id = u.id AND oc.tenant_id = u.tenant_id
  WHERE u.tenant_id = p_tenant_id
    AND u.activo = true
    AND u.tipo_ubicacion = 'picking'
    AND (u.sucursal_id IS NULL OR u.sucursal_id = p_sucursal_id)
  ORDER BY
    -- (1) La que ya tiene stock de este producto: evita partir el SKU en dos caras de picking.
    (EXISTS (
      SELECT 1 FROM inventario_lineas il
      WHERE il.ubicacion_id = u.id AND il.producto_id = p_producto_id AND il.activo = true
    )) DESC,
    -- (2) La que tiene lugar. Espejo de `ubicacionSinLugar()` en src/lib/medidasLogistica.ts —
    --     si cambia una, cambiar la otra.
    (NOT (
         (COALESCE(u.capacidad_pallets, 0) > 0 AND COALESCE(oc.lpn_activos, 0) >= u.capacidad_pallets)
      OR (COALESCE(u.peso_max_kg, 0)     > 0 AND COALESCE(oc.peso_kg, 0)     >= u.peso_max_kg)
      -- El volumen solo cuenta con el cubicaje ACTIVO y la ubicación medida: sin las dos cosas el
      -- número no significa nada (una ubicación sin medir daría capacidad útil 0 = siempre llena).
      OR (COALESCE(t.cubicaje_habilitado, false)
          AND COALESCE(u.alto_cm, 0) > 0 AND COALESCE(u.ancho_cm, 0) > 0 AND COALESCE(u.largo_cm, 0) > 0
          AND COALESCE(oc.volumen_m3, 0) >=
              (u.alto_cm * u.ancho_cm * u.largo_cm / 1000000.0)
              * GREATEST(LEAST(COALESCE(t.cubicaje_factor_aprovechamiento, 0.70), 1), 0.01))
    )) DESC,
    -- (3) Lo de siempre: recorrido del depósito y prioridad de rebaje.
    u.secuencia NULLS LAST,
    u.prioridad,
    -- Desempate final estable: sin esto, dos posiciones equivalentes pueden alternar entre llamadas
    -- y mandar el mismo SKU a caras distintas en dos reabastecimientos seguidos.
    u.id
  LIMIT 1
$$;

COMMENT ON FUNCTION public.fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) IS
  'Destino de una tarea de reabastecimiento (bulk→picking). Prefiere la posición que ya tiene ese producto, después la que TIENE LUGAR (LPN/peso/volumen contra los topes configurados, mig 326) y por último secuencia/prioridad. La capacidad DESEMPATA, nunca excluye: si están todas llenas devuelve una igual, porque dejar la tarea sin destino frenaría mercadería real por un dato de configuración.';

REVOKE ALL ON FUNCTION fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_wms_elegir_ubicacion_picking(uuid, uuid, uuid) TO authenticated, service_role;
