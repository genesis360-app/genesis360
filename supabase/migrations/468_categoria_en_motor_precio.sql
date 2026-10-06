-- 468 — B2 / Fase 4: la CATEGORÍA del cliente dentro del motor único de precio + tope de descuento acumulado
--
-- Reglas (relevamiento de Categorías, respuestas de Fede 20/09 + GO 25/09, 30/09 y 03/10):
--  · A1 / B-2: categoría y precio mayorista COMPITEN, gana el más bajo, no se acumulan. Precio de categoría =
--    precio de lista vigente × (1 − %), en la misma etapa que el tier y ANTES del redondeo. Con bloques de empaque la
--    competencia es por bloque (el precio de categoría no depende de la cantidad). En empate se informa "categoria".
--  · B5 / C4: el % es POR PRODUCTO (`categoria_cliente_descuentos`, mig 466). Sin fila o 0 % = sin precio de categoría.
--  · B4: sin cliente no hay categoría. Categoría DESACTIVADA = como si no tuviera (mismo criterio que la CC, mig 442).
--  · GO 03/10: la categoría aplica también en un canal con lista "minorista" (el canal solo apaga el mayorista).
--  · A2 + GO 03/10: para un cliente con categoría ACTIVA, en las unidades de un lote con descuento por estado compiten
--    tier, categoría y estado, todos medidos contra la lista; gana el más bajo (aunque el producto no tenga % cargado).
--    Sin categoría, el estado se sigue acumulando sobre el precio como hoy. El motor lo informa (`estado_compite`) y el
--    descuento por estado lo aplica quien conoce el LPN (POS en el navegador, Pedidos en `fn_pedido_generar_venta`).
--  · F2: cada línea guarda precio de lista, mecanismo que definió el precio, categoría y %.
--  · A4 + B-5 + PL-1: tope de descuento ACUMULADO por venta, % configurable por negocio, medido contra el precio de
--    lista y contando todo (tier, categoría, estado, manual, general, combos, cupón, promo por medio de pago). Nadie lo
--    saltea, ni el DUEÑO: para vender más barato se sube el tope en Configuración (queda en el historial). Sin tope
--    configurado no rige ninguno (como hoy). Guard en la base además del POS.
--
-- `mecanismo_precio` lo informa quien vende (POS / Pedidos) y es solo para reportes; lista, categoría y % los pone
-- el servidor.
--
-- Clientes SIN categoría: exactamente el mismo precio que antes (se valida con `scripts/paridad-motor-precio.mjs`).

-- ── Datos ───────────────────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.venta_items
  ADD COLUMN IF NOT EXISTS precio_lista_unitario    numeric(14,2),
  ADD COLUMN IF NOT EXISTS mecanismo_precio         text,
  ADD COLUMN IF NOT EXISTS categoria_cliente_id     uuid REFERENCES public.categorias_cliente(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS categoria_descuento_pct  numeric(5,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venta_items_mecanismo_precio_check') THEN
    ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_mecanismo_precio_check
      CHECK (mecanismo_precio IS NULL OR mecanismo_precio IN ('lista', 'tier', 'empaque', 'canal_mayorista', 'categoria'));
  END IF;
END $$;

COMMENT ON COLUMN public.venta_items.precio_lista_unitario IS 'Mig 468 (F2): precio de lista por unidad base al vender (lo pone el servidor). NULL en ventas anteriores.';
COMMENT ON COLUMN public.venta_items.mecanismo_precio IS 'Mig 468 (F2): qué definió el precio unitario efectivo: lista / tier / empaque / canal_mayorista / categoria.';
COMMENT ON COLUMN public.venta_items.categoria_cliente_id IS 'Mig 468 (F2): categoría del cliente al vender (si tenía una activa).';
COMMENT ON COLUMN public.venta_items.categoria_descuento_pct IS 'Mig 468 (F2): % de la categoría para ese producto al vender (NULL = sin cargar).';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS descuento_tope_acumulado_pct numeric(5,2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_descuento_tope_acumulado_pct_check') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_descuento_tope_acumulado_pct_check
      CHECK (descuento_tope_acumulado_pct IS NULL OR (descuento_tope_acumulado_pct >= 0 AND descuento_tope_acumulado_pct <= 100));
  END IF;
END $$;
COMMENT ON COLUMN public.tenants.descuento_tope_acumulado_pct IS
  'Mig 468 (A4/B-5/PL-1): tope de descuento acumulado por venta, % sobre el precio de lista. NULL = no rige. Nadie lo saltea.';

-- ── Motor: núcleo + categoría ───────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_precio_motor_cliente(
  p_tenant_id uuid, p_producto_id uuid, p_cantidad numeric, p_lista text DEFAULT NULL, p_cliente_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r          jsonb;
  v_cat_id     uuid;
  v_cat_nombre text;
  v_pct        numeric;
  v_lista      numeric;
  v_precio_cat numeric;
  v_bloque     jsonb;
  v_bloques    jsonb := '[]'::jsonb;
  v_total      numeric := 0;
  v_cant       numeric := 0;
  v_gana_cat   boolean := false;
  v_base       numeric;
BEGIN
  v_r := fn_precio_motor_producto(p_tenant_id, p_producto_id, p_cantidad, p_lista);
  IF v_r IS NULL THEN RETURN NULL; END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT cat.id, cat.nombre INTO v_cat_id, v_cat_nombre
    FROM clientes c JOIN categorias_cliente cat ON cat.id = c.categoria_cliente_id AND cat.activo
    WHERE c.id = p_cliente_id AND c.tenant_id = p_tenant_id AND cat.tenant_id = p_tenant_id;
  END IF;

  v_r := v_r || jsonb_build_object(
    'precio_sin_categoria', v_r->'precio_base',
    'mecanismo_sin_categoria', v_r->'mecanismo',
    'estado_compite', v_cat_id IS NOT NULL,
    'categoria_id', v_cat_id, 'categoria_nombre', v_cat_nombre);
  IF v_cat_id IS NULL THEN RETURN v_r; END IF;

  SELECT descuento_pct INTO v_pct FROM categoria_cliente_descuentos
  WHERE categoria_id = v_cat_id AND producto_id = p_producto_id AND tenant_id = p_tenant_id;
  v_r := v_r || jsonb_build_object('categoria_pct', v_pct);
  IF COALESCE(v_pct, 0) <= 0 THEN RETURN v_r; END IF;

  v_lista := (v_r->>'precio_lista')::numeric;
  v_precio_cat := round(v_lista * (1 - LEAST(100, v_pct) / 100), 2);
  v_r := v_r || jsonb_build_object('precio_categoria', v_precio_cat);

  -- Cada bloque toma el más bajo entre su precio y el de categoría (empate → categoría).
  FOR v_bloque IN SELECT * FROM jsonb_array_elements(v_r->'bloques') LOOP
    IF v_precio_cat <= (v_bloque->>'precio_unitario')::numeric THEN
      v_bloque := v_bloque || jsonb_build_object('precio_unitario', v_precio_cat, 'mecanismo', 'categoria');
      v_gana_cat := true;
    END IF;
    v_bloques := v_bloques || jsonb_build_array(v_bloque);
    v_cant  := v_cant  + (v_bloque->>'cantidad')::numeric;
    v_total := v_total + (v_bloque->>'cantidad')::numeric * (v_bloque->>'precio_unitario')::numeric;
  END LOOP;

  IF NOT v_gana_cat THEN RETURN v_r; END IF;
  v_base := CASE WHEN v_cant > 0 THEN round(v_total / v_cant, 2) ELSE v_precio_cat END;
  RETURN v_r || jsonb_build_object('precio_base', v_base, 'mecanismo', 'categoria', 'bloques', v_bloques);
END;
$function$;

COMMENT ON FUNCTION public.fn_precio_motor_cliente(uuid, uuid, numeric, text, uuid) IS
  'Mig 468: núcleo del motor + categoría del cliente (compite con tier/empaque/canal, gana el más bajo). Interno.';
REVOKE ALL ON FUNCTION public.fn_precio_motor_cliente(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_precio_motor_cliente(uuid, uuid, numeric, text, uuid) TO service_role;

-- Descuento por estado de UNA porción de stock, con la regla de A2. Precio por unidad que se descuenta:
--  · sin categoría: precio efectivo × % (se acumula, como siempre);
--  · con categoría activa: compite contra la lista → max(0, precio efectivo − lista × (1 − %)).
CREATE OR REPLACE FUNCTION public.fn_descuento_estado_unitario(
  p_precio_efectivo numeric, p_precio_lista numeric, p_pct numeric, p_compite boolean
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(p_pct, 0) <= 0 OR COALESCE(p_precio_efectivo, 0) <= 0 THEN 0
    WHEN p_compite THEN GREATEST(p_precio_efectivo - round(p_precio_lista * (1 - LEAST(100, p_pct) / 100), 2), 0)
    ELSE p_precio_efectivo * p_pct / 100 END;
$$;
REVOKE ALL ON FUNCTION public.fn_descuento_estado_unitario(numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_descuento_estado_unitario(numeric, numeric, numeric, boolean) TO authenticated, service_role;

-- ── POS / Pedidos: misma firma que mig 467, ahora con la categoría ───────────────────────────────────────────────────

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
  v_tope    numeric;
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

  SELECT precio_redondeo, descuento_tope_acumulado_pct INTO v_modo, v_tope FROM tenants WHERE id = v_tenant;
  SELECT c.venta INTO v_cot FROM fn_cotizacion_bna_vigente('USD') c;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'producto_id' IS NULL THEN RAISE EXCEPTION 'Línea sin producto'; END IF;
    v_prod := (v_item->>'producto_id')::uuid;
    v_cant := COALESCE((v_item->>'cantidad')::numeric, 0);
    IF v_cant < 0 THEN RAISE EXCEPTION 'Cantidad negativa'; END IF;
    v_totales := jsonb_set(v_totales, ARRAY[v_prod::text],
      to_jsonb(COALESCE((v_totales->>v_prod::text)::numeric, 0) + v_cant));
  END LOOP;

  FOR v_prod, v_cant IN SELECT key::uuid, value::numeric FROM jsonb_each_text(v_totales) LOOP
    BEGIN
      v_r := fn_precio_motor_cliente(v_tenant, v_prod, v_cant, p_lista, p_cliente_id);
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

  RETURN jsonb_build_object('cotizacion_usd', v_cot, 'redondeo', COALESCE(v_modo, 'none'),
    'tope_descuento_pct', v_tope, 'lineas', v_lineas);
END;
$function$;

-- ── Guard del tope (server-side, además del POS) ─────────────────────────────────────────────────────────────────────
--
-- 1) BEFORE INSERT OR UPDATE por fila: la lista, la categoría y su % los pone el SERVIDOR (bajar la lista desde el
--    navegador escondería el descuento). La lista que se guarda es la REDONDEADA con el redondeo del negocio: es lo que
--    paga un cliente sin ningún descuento, y contra eso se mide el tope (sin redondear, un negocio con redondeo de $100
--    tendría rechazos falsos en el borde). En un UPDATE la lista de una venta ya hecha NO se reescribe (REGLA #0,
--    punto 7); solo se recalcula en un presupuesto ('pendiente') cuando cambia su precio ("Actualizar precios").
-- 2) CONSTRAINT TRIGGER DIFERIDO: controla la venta COMPLETA al confirmar la transacción, ya con todas sus líneas y con el
--    descuento por estado aplicado (Pedidos inserta de a una línea y descuenta el estado después con UPDATE; un control
--    inmediato rechazaría un pedido válido). En UPDATE solo controla si lo cobrado BAJA.
-- Solo con sesión de usuario: las importaciones de Mercado Libre / Tienda Nube (service_role) cobran el precio del
-- canal, que no es el de lista, y no son una venta de mostrador. Las líneas sin producto no cuentan.

CREATE OR REPLACE FUNCTION public.fn_venta_items_precio_lista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r       jsonb;
  v_cliente uuid;
  v_estado  text;
  v_modo    text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT estado INTO v_estado FROM ventas WHERE id = NEW.venta_id;
    IF v_estado IS DISTINCT FROM 'pendiente'
       OR (NEW.precio_unitario IS NOT DISTINCT FROM OLD.precio_unitario AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id) THEN
      NEW.precio_lista_unitario   := OLD.precio_lista_unitario;
      NEW.categoria_cliente_id    := OLD.categoria_cliente_id;
      NEW.categoria_descuento_pct := OLD.categoria_descuento_pct;
      RETURN NEW;
    END IF;
  END IF;

  NEW.precio_lista_unitario := NULL;
  NEW.categoria_cliente_id := NULL;
  NEW.categoria_descuento_pct := NULL;
  IF NEW.producto_id IS NULL OR auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT cliente_id INTO v_cliente FROM ventas WHERE id = NEW.venta_id;
  SELECT precio_redondeo INTO v_modo FROM tenants WHERE id = NEW.tenant_id;
  BEGIN
    v_r := fn_precio_motor_cliente(NEW.tenant_id, NEW.producto_id, 0, NULL, v_cliente);
  EXCEPTION WHEN OTHERS THEN
    v_r := NULL;   -- p. ej. producto en USD sin cotización: el POS no lo deja vender; acá no se inventa una lista
  END;
  IF v_r IS NOT NULL THEN
    NEW.precio_lista_unitario := fn_precio_redondear((v_r->>'precio_lista')::numeric, v_modo);
    NEW.categoria_cliente_id := (v_r->>'categoria_id')::uuid;
    NEW.categoria_descuento_pct := (v_r->>'categoria_pct')::numeric;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_venta_items_precio_lista ON public.venta_items;
CREATE TRIGGER trg_venta_items_precio_lista
  BEFORE INSERT OR UPDATE ON public.venta_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_venta_items_precio_lista();

-- Control de UNA venta (lo usa el trigger diferido).
CREATE OR REPLACE FUNCTION public.fn_venta_tope_descuento_check(p_venta_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
BEGIN
  SELECT t.descuento_tope_acumulado_pct AS tope,
         SUM(vi.cantidad * vi.precio_lista_unitario) AS lista, SUM(vi.subtotal) AS cobrado
    INTO v
  FROM venta_items vi JOIN tenants t ON t.id = vi.tenant_id
  WHERE vi.venta_id = p_venta_id AND vi.producto_id IS NOT NULL AND vi.precio_lista_unitario IS NOT NULL
  GROUP BY t.descuento_tope_acumulado_pct;
  IF v.tope IS NULL OR COALESCE(v.lista, 0) <= 0 THEN RETURN; END IF;
  IF (v.lista - v.cobrado) / v.lista * 100 > v.tope + 0.005 THEN
    RAISE EXCEPTION 'La venta tiene un descuento total de % %% sobre el precio de lista y el tope del negocio es % %%. Para vender más barato hay que subir el tope en Configuración → Ventas.',
      replace(to_char(round((v.lista - v.cobrado) / v.lista * 100, 2), 'FM990.00'), '.', ','),
      replace(to_char(v.tope, 'FM990.00'), '.', ',')
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_venta_tope_descuento_check(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_venta_items_tope_descuento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.subtotal >= OLD.subtotal THEN RETURN NULL; END IF;
  PERFORM fn_venta_tope_descuento_check(NEW.venta_id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_venta_items_tope_descuento ON public.venta_items;
CREATE CONSTRAINT TRIGGER trg_venta_items_tope_descuento
  AFTER INSERT OR UPDATE ON public.venta_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_venta_items_tope_descuento();

REVOKE ALL ON FUNCTION public.fn_venta_items_precio_lista() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_venta_items_tope_descuento() FROM PUBLIC, anon, authenticated;

-- ── Pedidos → venta: precio desde el motor con el cliente del pedido ────────────────────────────────────────────────
-- Definición vigente leída de la base (DEV = PROD salvo fin de línea). Cambios, y nada más:
--  (a) el precio sale de `fn_precios_lineas` (mismo motor que el POS) con el cliente del pedido;
--  (b) el descuento por estado usa `fn_descuento_estado_unitario` (A2: compite si el cliente tiene categoría);
--  (c) graba `mecanismo_precio` (F2; lista, categoría y % los pone el trigger).
-- El tope lo controla el trigger diferido al confirmar (ya con el estado descontado). `fn_precios_lineas` toma el
-- negocio de la sesión: esta función solo se llama desde la app con usuario (como siempre, por la RLS de pedidos).

CREATE OR REPLACE FUNCTION public.fn_pedido_generar_venta(p_pedido_id uuid, p_sesion_caja_id uuid, p_medio_pago jsonb, p_entregas jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido          RECORD;
  v_sesion          RECORD;
  v_venta_existente uuid;
  v_item            RECORD;
  v_cant_entregar    numeric;
  v_cant_override    numeric;
  v_venta_id         uuid;
  v_subtotal         numeric := 0;
  v_total            numeric := 0;
  v_producto         RECORD;
  v_precio           numeric;
  v_cant_sku         numeric;
  v_desc_monto       numeric;
  v_desc_pct         numeric;
  v_desc_pcts        integer;
  v_pct_linea        numeric;
  v_iva_monto        numeric;
  v_item_subtotal    numeric;
  v_venta_item_id    uuid;
  v_linea            RECORD;
  v_restante         numeric;
  v_tomar            numeric;
  v_stock_antes      numeric;
  v_stock_despues    numeric;
  v_todo_entregado   boolean := true;
  v_hubo_entrega     boolean := false;
  v_cierre_auto      boolean;
  v_monto_efectivo   numeric := 0;
  v_monto_pagado     numeric := 0;
  v_monto_cc         numeric := 0;
  v_mp               jsonb;
  v_tiene_cc         boolean := false;
  v_traza_on         boolean;
  v_deuda_total      numeric;
  v_limite_credito   numeric;
  v_enforcement_pol  text;
  v_motor            jsonb;
  v_desc_u           numeric;
BEGIN
  SELECT * INTO v_pedido FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Pedido inexistente o sin permisos'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_venta_existente FROM ventas
    WHERE pedido_id = p_pedido_id AND pedido_entrega_key = p_idempotency_key;
    IF v_venta_existente IS NOT NULL THEN RETURN v_venta_existente; END IF;
  END IF;

  IF v_pedido.estado NOT IN ('en_preparacion', 'listo_para_entrega', 'entregado_parcial') THEN
    RAISE EXCEPTION 'El pedido tiene que estar lanzado (en preparación, listo para entrega, o entregado parcial) para generar la venta';
  END IF;

  SELECT * INTO v_sesion FROM caja_sesiones WHERE id = p_sesion_caja_id FOR UPDATE;
  IF v_sesion IS NULL OR v_sesion.tenant_id <> v_pedido.tenant_id OR v_sesion.estado <> 'abierta' THEN
    RAISE EXCEPTION 'No hay una caja abierta válida para registrar el ingreso — abrí una caja antes de generar la venta';
  END IF;
  IF v_sesion.sucursal_id IS NOT NULL AND v_pedido.sucursal_id IS NOT NULL AND v_sesion.sucursal_id <> v_pedido.sucursal_id THEN
    RAISE EXCEPTION 'La caja elegida es de otra sucursal — elegí una caja abierta de la sucursal del pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') = 'Cuenta Corriente' THEN v_tiene_cc := true; END IF;
  END LOOP;
  IF v_tiene_cc AND v_pedido.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere un cliente identificado en el pedido';
  END IF;
  -- Mig 442 (decisión de GO): la CC habilitada también la controla el servidor (condición EFECTIVA).
  IF v_tiene_cc AND NOT COALESCE((SELECT e.cc_habilitada FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id), false) THEN
    RAISE EXCEPTION 'El cliente no tiene cuenta corriente habilitada. Cobrá por otro medio.';
  END IF;

  SELECT trazabilidad_asignacion INTO v_traza_on FROM tenants WHERE id = v_pedido.tenant_id;

  INSERT INTO ventas (
    tenant_id, cliente_id, cliente_nombre, cliente_telefono, consumidor_final, estado,
    subtotal, total, medio_pago, monto_pagado, es_cuenta_corriente, usuario_id, sucursal_id,
    origen, pedido_id, pedido_entrega_key, despachado_at
  ) VALUES (
    v_pedido.tenant_id, v_pedido.cliente_id,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_nombre END,
    CASE WHEN v_pedido.cliente_id IS NULL THEN v_pedido.cliente_telefono END,
    (v_pedido.cliente_id IS NULL), 'despachada', 0, 0, COALESCE(p_medio_pago, '[]'::jsonb)::text, 0,
    v_tiene_cc, auth.uid(), v_pedido.sucursal_id, 'Pedidos', p_pedido_id, p_idempotency_key, now()
  ) RETURNING id INTO v_venta_id;

  FOR v_item IN
    SELECT pi.id, pi.producto_id, pi.estado_id, pi.cantidad, pi.cantidad_entregada,
           (pi.cantidad - pi.cantidad_entregada) AS pendiente,
           pi.talle, pi.color, pi.encaje, pi.formato, pi.sabor_aroma
    FROM pedido_items pi
    WHERE pi.pedido_id = p_pedido_id AND pi.estado <> 'cancelada'
  LOOP
    v_cant_entregar := v_item.pendiente;
    IF p_entregas IS NOT NULL THEN
      v_cant_override := NULL;
      SELECT (e->>'cantidad')::numeric INTO v_cant_override
      FROM jsonb_array_elements(p_entregas) e
      WHERE (e->>'pedido_item_id')::uuid = v_item.id;
      IF v_cant_override IS NOT NULL THEN
        v_cant_entregar := LEAST(v_cant_override, v_item.pendiente);
      ELSE
        v_cant_entregar := 0;
      END IF;
    END IF;

    IF v_cant_entregar IS NULL OR v_cant_entregar <= 0 THEN
      IF v_item.pendiente > 0 THEN v_todo_entregado := false; END IF;
      CONTINUE;
    END IF;

    SELECT nombre, sku, precio_venta, precio_costo, alicuota_iva INTO v_producto
    FROM productos WHERE id = v_item.producto_id;
    SELECT COALESCE(SUM(pi2.cantidad), v_cant_entregar) INTO v_cant_sku
    FROM pedido_items pi2
    WHERE pi2.pedido_id = p_pedido_id AND pi2.producto_id = v_item.producto_id
      AND pi2.estado <> 'cancelada';
    -- Mig 468: motor único con el cliente del pedido (categoría). Sin precio del motor no hay venta.
    v_motor := fn_precios_lineas(
      jsonb_build_array(jsonb_build_object('key', v_item.id, 'producto_id', v_item.producto_id, 'cantidad', v_cant_sku)),
      NULL, v_pedido.cliente_id)->'lineas'->0;
    IF v_motor ? 'error' THEN
      RAISE EXCEPTION 'No se pudo calcular el precio de % (SKU %): %', v_producto.nombre, v_producto.sku, v_motor->>'error';
    END IF;
    v_precio := (v_motor->>'precio_unitario')::numeric;
    v_item_subtotal := ROUND(v_precio * v_cant_entregar, 2);
    v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
      THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
      ELSE 0 END;

    INSERT INTO venta_items (
      tenant_id, venta_id, producto_id, cantidad, precio_unitario, precio_costo_historico,
      subtotal, alicuota_iva, iva_monto, pedido_item_id, mecanismo_precio
    ) VALUES (
      v_pedido.tenant_id, v_venta_id, v_item.producto_id, v_cant_entregar, v_precio,
      v_producto.precio_costo, v_item_subtotal, COALESCE(v_producto.alicuota_iva, 21), v_iva_monto, v_item.id,
      v_motor->>'mecanismo'
    ) RETURNING id INTO v_venta_item_id;

    v_subtotal := v_subtotal + v_item_subtotal;
    v_total := v_total + v_item_subtotal;

    v_desc_monto := 0; v_desc_pct := NULL; v_desc_pcts := 0;
    v_restante := v_cant_entregar;
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.ubicacion_id, il.lpn, il.estado_id
      FROM inventario_lineas il
      WHERE il.tenant_id = v_pedido.tenant_id AND il.producto_id = v_item.producto_id
        AND il.activo = true AND COALESCE(il.cantidad_reservada, 0) > 0
        AND (v_pedido.sucursal_id IS NULL OR il.sucursal_id = v_pedido.sucursal_id)
        AND (v_item.estado_id IS NULL OR il.estado_id = v_item.estado_id)
        AND (v_item.talle IS NULL OR il.talle = v_item.talle)
        AND (v_item.color IS NULL OR il.color = v_item.color)
        AND (v_item.encaje IS NULL OR il.encaje = v_item.encaje)
        AND (v_item.formato IS NULL OR il.formato = v_item.formato)
        AND (v_item.sabor_aroma IS NULL OR il.sabor_aroma = v_item.sabor_aroma)
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE OF il SKIP LOCKED
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      SELECT ei.descuento_pct INTO v_pct_linea
      FROM estados_inventario ei WHERE ei.id = v_linea.estado_id;
      IF COALESCE(v_pct_linea, 0) > 0 THEN
        -- Mig 468 (A2): con categoría activa el estado compite contra la lista; sin categoría se acumula (igual que antes).
        v_desc_u := fn_descuento_estado_unitario(v_precio, (v_motor->>'precio_lista')::numeric, v_pct_linea,
                                                 COALESCE((v_motor->>'estado_compite')::boolean, false));
        IF v_desc_u > 0 THEN
          v_desc_monto := v_desc_monto + ROUND(v_desc_u * v_tomar, 2);
          IF v_desc_pct IS NULL THEN
            v_desc_pct := v_pct_linea; v_desc_pcts := 1;
          ELSIF v_desc_pct <> v_pct_linea THEN
            v_desc_pcts := v_desc_pcts + 1;
          END IF;
        END IF;
      END IF;

      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_antes FROM inventario_lineas
        WHERE tenant_id = v_pedido.tenant_id AND producto_id = v_item.producto_id AND activo = true
          AND (v_pedido.sucursal_id IS NULL OR sucursal_id = v_pedido.sucursal_id);

      UPDATE inventario_lineas
        SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
            activo = (cantidad - v_tomar) > 0
        WHERE id = v_linea.id;

      v_stock_despues := v_stock_antes - v_tomar;

      INSERT INTO movimientos_stock (tenant_id, producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, venta_id, sucursal_id, linea_id)
      VALUES (v_pedido.tenant_id, v_item.producto_id, 'rebaje', v_tomar, v_stock_antes, v_stock_despues,
              'Pedido #' || v_pedido.numero, auth.uid(), v_venta_id, v_pedido.sucursal_id, v_linea.id);

      IF COALESCE(v_traza_on, true) THEN
        INSERT INTO venta_item_despachos (tenant_id, venta_id, venta_item_id, producto_id, linea_id, lpn, ubicacion_id, cantidad, origen)
        VALUES (v_pedido.tenant_id, v_venta_id, v_venta_item_id, v_item.producto_id, v_linea.id, v_linea.lpn, v_linea.ubicacion_id, v_tomar, 'auto');
      END IF;

      v_restante := v_restante - v_tomar;
    END LOOP;

    IF v_restante > 0 THEN
      RAISE EXCEPTION 'No hay stock reservado suficiente para entregar % (SKU %) — faltan % unidades. ¿Se lanzó el pedido?',
        v_producto.nombre, v_producto.sku, v_restante;
    END IF;

    IF v_desc_monto > 0 THEN
      v_item_subtotal := GREATEST(v_item_subtotal - v_desc_monto, 0);
      v_iva_monto := CASE WHEN COALESCE(v_producto.alicuota_iva, 0) > 0
        THEN ROUND(v_item_subtotal - v_item_subtotal / (1 + v_producto.alicuota_iva / 100), 2)
        ELSE 0 END;
      UPDATE venta_items
         SET subtotal = v_item_subtotal,
             iva_monto = v_iva_monto,
             descuento_estado_pct = CASE WHEN v_desc_pcts = 1 THEN v_desc_pct ELSE NULL END,
             descuento_estado_monto = v_desc_monto
       WHERE id = v_venta_item_id;
      v_subtotal := v_subtotal - v_desc_monto;
      v_total    := v_total    - v_desc_monto;
    END IF;

    UPDATE pedido_items SET
      cantidad_entregada = cantidad_entregada + v_cant_entregar,
      estado = CASE WHEN (cantidad_entregada + v_cant_entregar) >= cantidad THEN 'preparado' ELSE estado END
    WHERE id = v_item.id;

    v_hubo_entrega := true;
    IF (v_item.cantidad_entregada + v_cant_entregar) < v_item.cantidad THEN v_todo_entregado := false; END IF;
  END LOOP;

  IF NOT v_hubo_entrega THEN
    RAISE EXCEPTION 'No hay nada pendiente de entregar en este pedido';
  END IF;

  FOR v_mp IN SELECT * FROM jsonb_array_elements(COALESCE(p_medio_pago, '[]'::jsonb))
  LOOP
    IF (v_mp->>'tipo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_monto_pagado := v_monto_pagado + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      IF EXISTS (SELECT 1 FROM metodos_pago WHERE tenant_id = v_pedido.tenant_id AND nombre = (v_mp->>'tipo') AND es_efectivo = true) THEN
        v_monto_efectivo := v_monto_efectivo + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
      END IF;
    ELSE
      v_monto_cc := v_monto_cc + GREATEST(COALESCE((v_mp->>'monto')::numeric, v_total), 0);
    END IF;
  END LOOP;
  v_monto_pagado := LEAST(v_monto_pagado, v_total);
  v_monto_cc := LEAST(v_monto_cc, v_total);

  IF v_tiene_cc AND (v_total - v_monto_pagado) > 0.5 THEN
    -- Mig 442: política y límite EFECTIVOS (Cliente > Categoría > Negocio).
    SELECT e.cc_enforcement_politica INTO v_enforcement_pol FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;
    IF v_enforcement_pol = 'bloquear' THEN
      SELECT COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0) INTO v_deuda_total
      FROM ventas v
      WHERE v.cliente_id = v_pedido.cliente_id AND v.tenant_id = v_pedido.tenant_id
        AND v.es_cuenta_corriente = true AND v.estado <> 'cancelada'
        AND (v.total - v.monto_pagado) > 0.5;

      SELECT e.cc_limite INTO v_limite_credito FROM vw_clientes_cc e WHERE e.cliente_id = v_pedido.cliente_id;

      IF v_limite_credito IS NOT NULL AND (v_deuda_total + (v_total - v_monto_pagado)) > v_limite_credito + 0.5 THEN
        RAISE EXCEPTION 'Esta venta deja la cuenta corriente en $% — supera el límite de $%',
          ROUND(v_deuda_total + (v_total - v_monto_pagado), 0), ROUND(v_limite_credito, 0);
      END IF;
    END IF;
  END IF;

  -- D-1 fase 2 (mig 440): igual que el POS, si la venta lleva un producto con precio en dólares se
  -- sella la tasa con la que se convirtió (`ventas.cotizacion_usd`, mig 368). Dashboards y
  -- Rentabilidad separan por esa marca las ventas con componente en USD.
  UPDATE ventas SET subtotal = v_subtotal, total = v_total, monto_pagado = v_monto_pagado,
         cotizacion_usd = CASE WHEN EXISTS (
           SELECT 1 FROM venta_items vi JOIN productos pr ON pr.id = vi.producto_id
           WHERE vi.venta_id = v_venta_id AND pr.moneda_venta = 'usd' AND COALESCE(pr.precio_usd, 0) > 0
         ) THEN (SELECT c.venta FROM fn_cotizacion_bna_vigente('USD') c) END
   WHERE id = v_venta_id;

  IF v_monto_efectivo > 0.005 THEN
    INSERT INTO caja_movimientos (tenant_id, sesion_id, tipo, concepto, monto, usuario_id)
    VALUES (v_pedido.tenant_id, p_sesion_caja_id, 'ingreso', 'Pedido #' || v_pedido.numero, v_monto_efectivo, auth.uid());
  END IF;

  SELECT COALESCE(pedido_cierre_automatico, true) INTO v_cierre_auto FROM tenants WHERE id = v_pedido.tenant_id;
  IF v_todo_entregado AND v_cierre_auto THEN
    UPDATE pedidos SET estado = 'entregado', entregado_at = now() WHERE id = p_pedido_id;
  ELSE
    UPDATE pedidos SET estado = 'entregado_parcial' WHERE id = p_pedido_id;
  END IF;

  RETURN v_venta_id;
END;
$function$;
