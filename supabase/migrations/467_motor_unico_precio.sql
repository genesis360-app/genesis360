-- 467 — B2 / Fase 3: MOTOR ÚNICO de precio en SQL (sin cambiar ningún precio)
--
-- Decisión de GO (2026-10-02, B2): un solo motor de precio, en la base; el POS y Pedidos lo consultan. Hasta hoy había
-- DOS motores espejo que tenían que dar el mismo número (y ya hubo bugs de plata por desincronizarlos, migs 330 y 367):
--   · `src/lib/tiers.ts` (POS, presupuestos) — `precioBlendedTier`, `mejorPrecioMayorista` + `redondearPrecio`.
--   · `fn_precio_venta_efectivo` (Pedidos → `fn_pedido_generar_venta`), mig 440.
--
-- Esta migración:
--   1. Crea el NÚCLEO `fn_precio_motor_producto(tenant, producto, cantidad_total_sku, lista)`: precio de lista (con USD a
--      la tasa única BNA, D-1), tiers por cantidad (gana el primero en `orden`), tiers enlazados a empaque por bloques
--      (compiten con el tier normal, gana el mejor), y la lista forzada por canal ('minorista' / 'mayorista'). Devuelve
--      el precio SIN redondeo + el mecanismo que ganó + los bloques. Es la lógica de mig 440 y de tiers.ts, línea por
--      línea; no hay regla nueva.
--   2. `fn_precio_venta_efectivo` (misma firma, mismo resultado) pasa a ser una envoltura del núcleo. Conserva sus dos
--      particularidades: producto inexistente → 0, y cantidad ≤ 0 → precio de lista SIN redondeo.
--      🔒 Además cierra una fuga que venía de la mig 317: con sesión, solo acepta el negocio propio.
--   3. Crea `fn_precios_lineas(items, lista, cliente)` para el POS: una ida por carrito. Agrega la cantidad POR SKU en
--      todo el carrito (decisión de Fede, mig 306: el mayorista es por volumen, no por línea), aplica el redondeo del
--      negocio (`tenants.precio_redondeo`) y devuelve, por línea, el precio unitario EFECTIVO del que deriva toda la
--      plata (subtotal, IVA, factura). El negocio sale de la sesión (`get_user_tenant_id()`), nunca del llamador.
--      `p_cliente_id` todavía no cambia nada: queda en la firma para la Fase 4 (lista de la categoría), así el POS no
--      cambia de llamada después.
--
-- Fuera del núcleo (siguen donde están, se aplican DESPUÉS del precio efectivo, igual que hoy): descuento manual de la
-- línea, combos, descuento por estado del LPN, descuento general, cupón y promo por medio de pago.
--
-- Validación (REGLA #0): antes de aplicar se comparó, en DEV, la función vieja (mig 440) contra la nueva sobre todos los
-- productos con tiers × cantidades (incluidos múltiplos de cada empaque ± 1), y el núcleo contra `tiers.ts` con el
-- script `scripts/paridad-motor-precio.mjs`. Ver UAT §97.

-- ── Ayudantes puros ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ¿`cantidad <operador> valor`? (espejo de `matchTier`)
CREATE OR REPLACE FUNCTION public.fn_tier_match(p_cantidad numeric, p_valor numeric, p_operador text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE p_operador
    WHEN '>'  THEN p_cantidad >  p_valor
    WHEN '<'  THEN p_cantidad <  p_valor
    WHEN '='  THEN p_cantidad =  p_valor
    WHEN '>=' THEN p_cantidad >= p_valor
    WHEN '<=' THEN p_cantidad <= p_valor
    ELSE false END;
$$;

-- Precio por unidad de un tier aplicado al precio de LISTA (espejo de `precioUnitarioDeTier`). Un tier en USD sin
-- cotización no se aplica (devuelve la lista), mismo criterio defensivo de siempre.
CREATE OR REPLACE FUNCTION public.fn_tier_precio_unitario(p_tipo_valor text, p_precio numeric, p_precio_lista numeric, p_cotizacion numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_tipo_valor = 'pct' THEN round(p_precio_lista * (1 - LEAST(100, GREATEST(0, p_precio)) / 100), 2)
    WHEN p_tipo_valor = 'usd' AND COALESCE(p_cotizacion, 0) > 0 THEN round(p_precio * p_cotizacion, 2)
    WHEN p_tipo_valor = 'usd' THEN p_precio_lista
    ELSE p_precio END;
$$;

-- ── Núcleo ──────────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_precio_motor_producto(
  p_tenant_id uuid, p_producto_id uuid, p_cantidad numeric, p_lista text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_precio_lista   numeric;
  v_moneda_venta   text;
  v_precio_usd     numeric;
  v_es_usd         boolean := false;
  v_cotizacion     numeric;
  v_t              RECORD;
  v_precio_u       numeric;
  v_lig_precio     numeric;
  v_lig_cant       numeric;
  v_n_multiplos    numeric;
  v_bloque_precio  numeric;
  v_bloque_mec     text;
  v_resto          numeric;
  v_resto_precio   numeric;
  v_resto_mec      text;
  v_base           numeric;
  v_mec            text;
  v_bloques        jsonb;
BEGIN
  SELECT COALESCE(precio_venta, 0), moneda_venta, precio_usd
    INTO v_precio_lista, v_moneda_venta, v_precio_usd
  FROM productos WHERE id = p_producto_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- D-1: la UNA tasa USD→ARS del sistema = vendedor divisa BNA del día hábil anterior.
  SELECT c.venta INTO v_cotizacion FROM fn_cotizacion_bna_vigente('USD') c;

  IF v_moneda_venta = 'usd' AND COALESCE(v_precio_usd, 0) > 0 THEN
    IF COALESCE(v_cotizacion, 0) <= 0 THEN
      RAISE EXCEPTION 'El producto tiene precio en dólares y no hay cotización del dólar BNA';
    END IF;
    v_precio_lista := round(v_precio_usd * v_cotizacion, 2);
    v_es_usd := true;
  END IF;

  -- Lista forzada por el canal (VF2/I2). 'mayorista' = el tier normal más barato, sin mirar la cantidad (los enlazados a
  -- empaque no: dependen de comprar múltiplos completos). Sin tiers normales → lista.
  IF p_lista = 'minorista' THEN
    v_base := v_precio_lista; v_mec := 'lista';
  ELSIF p_lista = 'mayorista' THEN
    SELECT min(fn_tier_precio_unitario(tipo_valor, precio, v_precio_lista, v_cotizacion)) INTO v_base
    FROM producto_precios_mayorista
    WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      AND precio IS NOT NULL AND precio >= 0;
    IF v_base IS NULL THEN v_base := v_precio_lista; v_mec := 'lista'; ELSE v_mec := 'canal_mayorista'; END IF;
  ELSIF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    v_base := v_precio_lista; v_mec := 'lista';
  END IF;

  IF v_mec IS NOT NULL THEN
    RETURN jsonb_build_object(
      'precio_lista', v_precio_lista, 'precio_base', v_base, 'mecanismo', v_mec, 'es_usd', v_es_usd,
      'cotizacion_usd', CASE WHEN v_es_usd THEN v_cotizacion END,
      'bloques', jsonb_build_array(jsonb_build_object('cantidad', GREATEST(COALESCE(p_cantidad, 0), 0), 'precio_unitario', v_base, 'mecanismo', v_mec)));
  END IF;

  -- Tiers ENLAZADOS a un empaque: se comparan contra MÚLTIPLOS completos; entre varios gana el más barato.
  FOR v_t IN
    SELECT ppm.cantidad_minima, ppm.precio, ppm.operador, ppm.tipo_valor, pp.factor_base
    FROM producto_precios_mayorista ppm
    JOIN producto_presentaciones pp ON pp.id = ppm.presentacion_id
    WHERE ppm.tenant_id = p_tenant_id AND ppm.producto_id = p_producto_id
      AND ppm.presentacion_id IS NOT NULL AND pp.factor_base > 0
    ORDER BY ppm.orden, ppm.id
  LOOP
    CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
    v_n_multiplos := floor(p_cantidad / v_t.factor_base);
    CONTINUE WHEN v_n_multiplos < 1;
    IF fn_tier_match(v_n_multiplos, v_t.cantidad_minima, v_t.operador) THEN
      v_precio_u := fn_tier_precio_unitario(v_t.tipo_valor, v_t.precio, v_precio_lista, v_cotizacion);
      IF v_lig_precio IS NULL OR v_precio_u < v_lig_precio THEN
        v_lig_precio := v_precio_u;
        v_lig_cant := v_n_multiplos * v_t.factor_base;
      END IF;
    END IF;
  END LOOP;

  IF v_lig_precio IS NULL THEN
    -- Sin bloque de empaque: gana el PRIMER tier normal que matchea la cantidad total (no el mejor).
    v_base := v_precio_lista; v_mec := 'lista';
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden, id
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF fn_tier_match(p_cantidad, v_t.cantidad_minima, v_t.operador) THEN
        v_base := fn_tier_precio_unitario(v_t.tipo_valor, v_t.precio, v_precio_lista, v_cotizacion);
        v_mec := 'tier';
        EXIT;
      END IF;
    END LOOP;
    v_bloques := jsonb_build_array(jsonb_build_object('cantidad', p_cantidad, 'precio_unitario', v_base, 'mecanismo', v_mec));
  ELSE
    -- El bloque de empaque compite contra el primer tier NORMAL que matchee esa misma cantidad.
    v_bloque_precio := v_lig_precio; v_bloque_mec := 'empaque';
    FOR v_t IN
      SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
      WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
      ORDER BY orden, id
    LOOP
      CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
      IF fn_tier_match(v_lig_cant, v_t.cantidad_minima, v_t.operador) THEN
        v_precio_u := fn_tier_precio_unitario(v_t.tipo_valor, v_t.precio, v_precio_lista, v_cotizacion);
        IF v_precio_u < v_bloque_precio THEN v_bloque_precio := v_precio_u; v_bloque_mec := 'tier'; END IF;
        EXIT;
      END IF;
    END LOOP;

    -- El resto suelto (no completa otro múltiplo) se evalúa aparte contra los tiers normales.
    v_resto := round(p_cantidad - v_lig_cant, 6);
    v_resto_precio := v_precio_lista; v_resto_mec := 'lista';
    IF v_resto > 0 THEN
      FOR v_t IN
        SELECT cantidad_minima, precio, operador, tipo_valor FROM producto_precios_mayorista
        WHERE tenant_id = p_tenant_id AND producto_id = p_producto_id AND presentacion_id IS NULL
        ORDER BY orden, id
      LOOP
        CONTINUE WHEN v_t.precio IS NULL OR v_t.precio < 0 OR v_t.cantidad_minima IS NULL;
        IF fn_tier_match(v_resto, v_t.cantidad_minima, v_t.operador) THEN
          v_resto_precio := fn_tier_precio_unitario(v_t.tipo_valor, v_t.precio, v_precio_lista, v_cotizacion);
          v_resto_mec := 'tier';
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- Promedio ponderado de los bloques: aplicado a cualquier reparto de la cantidad entre líneas, la plata total es la
    -- misma que cobrar cada bloque por separado (ver `precioBlendedTier`).
    v_base := round((v_lig_cant * v_bloque_precio + GREATEST(v_resto, 0) * v_resto_precio) / p_cantidad, 2);
    v_mec := v_bloque_mec;
    v_bloques := jsonb_build_array(jsonb_build_object('cantidad', v_lig_cant, 'precio_unitario', v_bloque_precio, 'mecanismo', v_bloque_mec));
    IF v_resto > 0 THEN
      v_bloques := v_bloques || jsonb_build_array(jsonb_build_object('cantidad', v_resto, 'precio_unitario', v_resto_precio, 'mecanismo', v_resto_mec));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'precio_lista', v_precio_lista, 'precio_base', v_base, 'mecanismo', v_mec, 'es_usd', v_es_usd,
    'cotizacion_usd', CASE WHEN v_es_usd THEN v_cotizacion END, 'bloques', v_bloques);
END;
$function$;

COMMENT ON FUNCTION public.fn_precio_motor_producto(uuid, uuid, numeric, text) IS
  'Mig 467: núcleo ÚNICO del precio de venta (lista/USD, tiers, empaque, lista por canal), sin redondeo. Interno: lo usan fn_precio_venta_efectivo y fn_precios_lineas.';

-- Interno: recibe el tenant como parámetro y es SECURITY DEFINER → nadie lo llama directo.
REVOKE ALL ON FUNCTION public.fn_precio_motor_producto(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_precio_motor_producto(uuid, uuid, numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tier_match(numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tier_match(numeric, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_tier_precio_unitario(text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tier_precio_unitario(text, numeric, numeric, numeric) TO authenticated, service_role;

-- Redondeo del negocio (espejo de `redondearPrecio`): múltiplo más cercano, half-up; ≤ 0 o 'none' → sin cambios.
CREATE OR REPLACE FUNCTION public.fn_precio_redondear(p_precio numeric, p_modo text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_precio IS NULL OR p_precio <= 0 THEN p_precio
    WHEN p_modo IN ('10', '50', '100', '500', '1000') THEN round(p_precio / p_modo::numeric) * p_modo::numeric
    ELSE p_precio END;
$$;
REVOKE ALL ON FUNCTION public.fn_precio_redondear(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_precio_redondear(numeric, text) TO authenticated, service_role;

-- ── Pedidos: misma firma, mismo resultado, ahora sobre el núcleo ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_precio_venta_efectivo(p_tenant_id uuid, p_producto_id uuid, p_cantidad numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r    jsonb;
  v_modo text;
BEGIN
  -- Antes (desde mig 317) cualquier usuario autenticado podía consultar precios y tiers de OTRO negocio pasando su id.
  -- Con sesión, el negocio tiene que ser el propio; sin sesión (service_role / interno) sigue igual.
  IF auth.uid() IS NOT NULL AND p_tenant_id IS DISTINCT FROM get_user_tenant_id() THEN
    RAISE EXCEPTION 'Negocio inválido';
  END IF;
  v_r := fn_precio_motor_producto(p_tenant_id, p_producto_id, p_cantidad, NULL);
  IF v_r IS NULL THEN RETURN 0; END IF;
  -- Histórico (mig 330/440): sin cantidad, el precio de lista SIN redondeo.
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN (v_r->>'precio_lista')::numeric; END IF;
  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = p_tenant_id;
  RETURN fn_precio_redondear((v_r->>'precio_base')::numeric, v_modo);
END;
$function$;

-- ── POS: el carrito entero en una ida ────────────────────────────────────────────────────────────────────────────────
--
-- p_items: [{ "key": "<id de la línea en el carrito>", "producto_id": "<uuid>", "cantidad": <unidades base> }, …]
-- Devuelve { cotizacion_usd, redondeo, lineas: [{ key, producto_id, cantidad_sku, precio_lista, precio_base,
--            precio_unitario, mecanismo, es_usd, bloques, error }] }. Una línea con `error` no tiene precio: el POS no
--            la cobra (PL-5 = A: nunca se inventa un precio).

CREATE OR REPLACE FUNCTION public.fn_precios_lineas(p_items jsonb, p_lista text DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := get_user_tenant_id();
  v_modo    text;
  v_cot     numeric;
  v_item    jsonb;
  v_prod    uuid;
  v_cant    numeric;
  v_totales jsonb := '{}'::jsonb;
  v_precios jsonb := '{}'::jsonb;
  v_r       jsonb;
  v_lineas  jsonb := '[]'::jsonb;
  v_err     text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin negocio en la sesión'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items tiene que ser una lista'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Demasiadas líneas (máximo 500)'; END IF;
  IF p_lista IS NOT NULL AND p_lista NOT IN ('minorista', 'mayorista') THEN RAISE EXCEPTION 'Lista de precios inválida'; END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'El cliente no pertenece a este negocio';
  END IF;

  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = v_tenant;
  SELECT c.venta INTO v_cot FROM fn_cotizacion_bna_vigente('USD') c;

  -- Cantidad TOTAL por SKU en todo el carrito (mig 306).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'producto_id' IS NULL THEN RAISE EXCEPTION 'Línea sin producto'; END IF;
    v_prod := (v_item->>'producto_id')::uuid;
    v_cant := COALESCE((v_item->>'cantidad')::numeric, 0);
    IF v_cant < 0 THEN RAISE EXCEPTION 'Cantidad negativa'; END IF;
    v_totales := jsonb_set(v_totales, ARRAY[v_prod::text],
      to_jsonb(COALESCE((v_totales->>v_prod::text)::numeric, 0) + v_cant));
  END LOOP;

  -- Un precio por SKU (todas sus líneas comparten el precio efectivo).
  FOR v_prod, v_cant IN SELECT key::uuid, value::numeric FROM jsonb_each_text(v_totales) LOOP
    BEGIN
      v_r := fn_precio_motor_producto(v_tenant, v_prod, v_cant, p_lista);
      IF v_r IS NULL THEN
        v_r := jsonb_build_object('error', 'Producto inexistente');
      ELSE
        v_r := v_r || jsonb_build_object('precio_unitario', fn_precio_redondear((v_r->>'precio_base')::numeric, v_modo));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_r := jsonb_build_object('error', v_err);
    END;
    v_precios := jsonb_set(v_precios, ARRAY[v_prod::text], v_r || jsonb_build_object('cantidad_sku', v_cant));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('key', v_item->'key', 'producto_id', v_item->>'producto_id')
      || (v_precios->(v_item->>'producto_id')));
  END LOOP;

  RETURN jsonb_build_object('cotizacion_usd', v_cot, 'redondeo', COALESCE(v_modo, 'none'), 'lineas', v_lineas);
END;
$function$;

COMMENT ON FUNCTION public.fn_precios_lineas(jsonb, text, uuid) IS
  'Mig 467: motor único de precio para el POS — precio unitario efectivo por línea del carrito (cantidad agregada por SKU, redondeo del negocio). El negocio sale de la sesión. p_cliente_id reservado para la Fase 4 (categoría).';

REVOKE ALL ON FUNCTION public.fn_precios_lineas(jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_precios_lineas(jsonb, text, uuid) TO authenticated, service_role;
