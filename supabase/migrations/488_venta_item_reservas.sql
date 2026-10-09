-- 488 — La reserva queda atada a la VENTA (REGLA #0, inventario) — Fase 0 de "picking con ubicaciones Globales"
--
-- Problema (relevado 2026-10-08, latente sin Globales): `inventario_lineas.cantidad_reservada` es un total por LPN y nada
-- guardaba QUÉ LPN reservó cada venta (`venta_items.lpn_plan` es el plan del carrito, no lo reservado). Entonces:
--   · anular una venta liberaba "las primeras reservas del producto", de cualquier venta y sucursal — incluso al anular una
--     venta YA DESPACHADA (que no tiene reservas) se liberaban reservas ajenas;
--   · reserva → despachada contaba como disponible lo reservado por OTRAS ventas y les descontaba la reserva;
--   · el vencimiento automático de reservas liberaba igual de a ciegas;
--   · deshacer el lanzamiento / cancelar un pedido de VENTA bajaba la reserva de la venta (el picking de un pedido de venta
--     nunca reservó — mig 316), y des-pickear una tarea de un pedido de venta movía el stock a un LPN nuevo SIN la reserva.
--
-- Modelo nuevo:
--   · `venta_item_reservas` (venta_item_id, linea_id, cantidad): qué LPN y cuánto reservó cada ítem. Sin escritura directa
--     (RLS solo SELECT): se escribe por funciones.
--   · `venta_items.reserva_anotada`: el ítem ya pasó por el modelo nuevo (reservó con la función, lo cubrió el backfill o ya
--     se liberó). Distingue "nunca anotado" de "ya liberado" → no hay doble liberación por el camino de compatibilidad.
--   · INVARIANTE: borrar una fila = liberar esa reserva (trigger AFTER DELETE baja `cantidad_reservada` del LPN), SALVO que
--     la venta esté despachada/facturada (el stock ya salió: la fila es un resto del camino viejo y no se descuenta nada).
--     Vale también para el borrado en cascada de la venta / el ítem.
--   · `fn_venta_reservar_linea` reserva atómicamente y anota; `fn_venta_liberar_reservas` libera lo anotado (+ el remanente
--     sin anotar por compatibilidad); `fn_venta_consumir_reservas` rebaja lo anotado al despachar y devuelve el desglose.
--   · Compatibilidad: reservas sin anotar (ítems que el backfill no cubrió y las de los webhooks de MercadoLibre/TiendaNube
--     hasta que pasen a la función nueva) se liberan como antes, pero SOLO en la sucursal de la venta, SOLO si la venta está
--     'reservada', SOLO una vez por ítem y sin tocar lo anotado por otras ventas.
--   · Backfill: anota las reservas vivas de las ventas 'reservada' a partir de los LPN con reserva del mismo producto y
--     sucursal (no modifica ningún LPN, solo agrega filas). Verificado antes de aplicar: PROD 7 ventas reservadas, los totales
--     reservados cuadran con los ítems en las 8 combinaciones producto×sucursal (no hay reservas de otro origen).
--
-- 🛑 NO es aditiva-segura frente al POS viejo: desplegar el front que usa estas funciones en el MISMO release.
-- Productos con serie: sin cambios (su reserva vive en inventario_series.reservado + venta_series).

-- ── Tabla + marca por ítem ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venta_item_reservas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  venta_id      uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  venta_item_id uuid NOT NULL REFERENCES public.venta_items(id) ON DELETE CASCADE,
  linea_id      uuid NOT NULL REFERENCES public.inventario_lineas(id) ON DELETE CASCADE,
  producto_id   uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  cantidad      integer NOT NULL CHECK (cantidad > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venta_item_id, linea_id)
);
CREATE INDEX IF NOT EXISTS idx_venta_item_reservas_venta ON public.venta_item_reservas (venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_item_reservas_linea ON public.venta_item_reservas (linea_id);

ALTER TABLE public.venta_items ADD COLUMN IF NOT EXISTS reserva_anotada boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.venta_items.reserva_anotada IS
  'Mig 488: la reserva de este ítem se maneja por venta_item_reservas (reservó con la función, la cubrió el backfill o ya se liberó). false = reserva vieja sin anotar.';

ALTER TABLE public.venta_item_reservas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'venta_item_reservas'
                 AND policyname = 'venta_item_reservas_select') THEN
    CREATE POLICY venta_item_reservas_select ON public.venta_item_reservas FOR SELECT TO authenticated
      USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;
REVOKE ALL ON public.venta_item_reservas FROM PUBLIC, anon;
GRANT SELECT ON public.venta_item_reservas TO authenticated;
GRANT ALL ON public.venta_item_reservas TO service_role;

COMMENT ON TABLE public.venta_item_reservas IS
  'Mig 488: qué LPN (y cuánto) reservó cada ítem de venta. Borrar una fila libera esa reserva (trigger) salvo venta despachada/facturada. Solo se escribe por funciones.';

-- ── Invariante: borrar = liberar ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venta_item_reserva_al_borrar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Venta despachada/facturada: el stock ya salió por otro camino; la fila es un resto → no se descuenta nada (si no,
  -- bajaría la reserva de OTRAS ventas del mismo LPN). Venta inexistente (borrado en cascada): se libera.
  IF EXISTS (SELECT 1 FROM ventas WHERE id = OLD.venta_id AND estado IN ('despachada', 'facturada')) THEN
    RETURN NULL;
  END IF;
  UPDATE inventario_lineas
     SET cantidad_reservada = GREATEST(0, COALESCE(cantidad_reservada, 0) - OLD.cantidad)
   WHERE id = OLD.linea_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_item_reserva_al_borrar ON public.venta_item_reservas;
CREATE TRIGGER trg_venta_item_reserva_al_borrar
  AFTER DELETE ON public.venta_item_reservas
  FOR EACH ROW EXECUTE FUNCTION public.fn_venta_item_reserva_al_borrar();

-- ── Acceso: mismo tenant y, para un usuario restringido, la sucursal de la venta ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venta_reserva_check_acceso(p_tenant_id uuid, p_venta_sucursal uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Sin usuario (service_role: webhooks, sweeps): pasa.
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF p_tenant_id IS DISTINCT FROM get_user_tenant_id() THEN
    RAISE EXCEPTION 'Venta inexistente o sin permisos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (auth_ve_todas_sucursales() OR p_venta_sucursal IS NULL OR p_venta_sucursal = auth_user_sucursal()) THEN
    RAISE EXCEPTION 'Venta inexistente o sin permisos' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- ── Reservar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_venta_reservar_linea(p_venta_item_id uuid, p_linea_id uuid, p_cantidad numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item     RECORD;
  v_linea    RECORD;
  v_reservar numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN 0; END IF;

  -- Lock de la venta: una liberación concurrente no puede dejar una reserva anotada sobre una venta ya cancelada.
  SELECT vi.id, vi.tenant_id, vi.venta_id, vi.producto_id, v.sucursal_id, v.estado
    INTO v_item
    FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
   WHERE vi.id = p_venta_item_id
   FOR UPDATE OF v;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Ítem de venta inexistente'; END IF;
  PERFORM fn_venta_reserva_check_acceso(v_item.tenant_id, v_item.sucursal_id);
  IF v_item.estado IN ('despachada', 'facturada', 'cancelada', 'devuelta') THEN
    RAISE EXCEPTION 'La venta está % — no se puede reservar stock', v_item.estado;
  END IF;

  SELECT id, tenant_id, producto_id, sucursal_id, activo, cantidad, COALESCE(cantidad_reservada, 0) AS reservada
    INTO v_linea
    FROM inventario_lineas WHERE id = p_linea_id FOR UPDATE;
  IF v_linea.id IS NULL OR NOT v_linea.activo THEN RETURN 0; END IF;   -- igual que fn_reservar_stock_linea: no rompe al caller
  IF v_linea.tenant_id <> v_item.tenant_id OR v_linea.producto_id <> v_item.producto_id THEN
    RAISE EXCEPTION 'El LPN no corresponde al producto de la venta';
  END IF;
  -- Inventario por sucursal estricto (la excepción de ubicaciones Globales llega en la Fase 1).
  IF v_linea.sucursal_id IS NOT NULL AND v_item.sucursal_id IS NOT NULL AND v_linea.sucursal_id <> v_item.sucursal_id THEN
    RAISE EXCEPTION 'Ese stock es de otra sucursal: no se puede reservar para esta venta' USING ERRCODE = 'check_violation';
  END IF;

  v_reservar := FLOOR(LEAST(p_cantidad, GREATEST(v_linea.cantidad - v_linea.reservada, 0)));
  IF v_reservar <= 0 THEN RETURN 0; END IF;

  UPDATE inventario_lineas SET cantidad_reservada = COALESCE(cantidad_reservada, 0) + v_reservar WHERE id = p_linea_id;

  INSERT INTO venta_item_reservas (tenant_id, venta_id, venta_item_id, linea_id, producto_id, cantidad)
  VALUES (v_item.tenant_id, v_item.venta_id, v_item.id, p_linea_id, v_item.producto_id, v_reservar::integer)
  ON CONFLICT (venta_item_id, linea_id) DO UPDATE SET cantidad = venta_item_reservas.cantidad + EXCLUDED.cantidad;

  UPDATE venta_items SET reserva_anotada = true WHERE id = v_item.id AND NOT reserva_anotada;

  RETURN v_reservar;
END;
$$;

-- ── Liberar (anular / cancelar / vencer) ─────────────────────────────────────────────────────────────────────────────────
-- Núcleo sin chequeo de acceso (lo usan el wrapper público y el vencimiento automático).
CREATE OR REPLACE FUNCTION public.fn_venta_liberar_reservas_nucleo(p_venta_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_venta     RECORD;
  v_item      RECORD;
  v_ln        RECORD;
  v_total     numeric := 0;
  v_borrado   numeric;
  v_restante  numeric;
  v_lib       numeric;
BEGIN
  SELECT id, tenant_id, sucursal_id, estado INTO v_venta FROM ventas WHERE id = p_venta_id FOR UPDATE;
  IF v_venta.id IS NULL THEN RETURN 0; END IF;

  FOR v_item IN
    SELECT vi.id, vi.producto_id, vi.cantidad, vi.reserva_anotada
      FROM venta_items vi JOIN productos p ON p.id = vi.producto_id
     WHERE vi.venta_id = p_venta_id AND NOT COALESCE(p.tiene_series, false)
     FOR UPDATE OF vi
  LOOP
    -- Lo anotado: borrar = liberar (trigger; no descuenta si la venta ya salió).
    WITH b AS (DELETE FROM venta_item_reservas WHERE venta_item_id = v_item.id RETURNING cantidad)
    SELECT COALESCE(SUM(cantidad), 0) INTO v_borrado FROM b;
    IF v_venta.estado NOT IN ('despachada', 'facturada') THEN
      v_total := v_total + v_borrado;
    END IF;

    -- Compatibilidad, UNA sola vez por ítem: el remanente sin anotar de una reserva vieja (o de webhook).
    IF NOT v_item.reserva_anotada AND v_venta.estado = 'reservada' THEN
      v_restante := v_item.cantidad - v_borrado;
      FOR v_ln IN
        SELECT il.id,
               COALESCE(il.cantidad_reservada, 0)
                 - COALESCE((SELECT SUM(r.cantidad) FROM venta_item_reservas r WHERE r.linea_id = il.id), 0) AS libre_de_anotar
          FROM inventario_lineas il
         WHERE il.tenant_id = v_venta.tenant_id AND il.producto_id = v_item.producto_id AND il.activo
           AND COALESCE(il.cantidad_reservada, 0) > 0
           AND (v_venta.sucursal_id IS NULL OR il.sucursal_id IS NULL OR il.sucursal_id = v_venta.sucursal_id)
         ORDER BY il.created_at
         FOR UPDATE OF il
      LOOP
        EXIT WHEN v_restante <= 0;
        v_lib := FLOOR(LEAST(v_restante, v_ln.libre_de_anotar));
        IF v_lib <= 0 THEN CONTINUE; END IF;
        UPDATE inventario_lineas SET cantidad_reservada = GREATEST(0, cantidad_reservada - v_lib) WHERE id = v_ln.id;
        v_restante := v_restante - v_lib;
        v_total := v_total + v_lib;
      END LOOP;
    END IF;

    -- Ya liberado: una segunda llamada no vuelve a entrar al camino de compatibilidad.
    UPDATE venta_items SET reserva_anotada = true WHERE id = v_item.id AND NOT reserva_anotada;
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_venta_liberar_reservas(p_venta_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_venta RECORD;
BEGIN
  SELECT id, tenant_id, sucursal_id INTO v_venta FROM ventas WHERE id = p_venta_id;
  IF v_venta.id IS NULL THEN RETURN 0; END IF;
  PERFORM fn_venta_reserva_check_acceso(v_venta.tenant_id, v_venta.sucursal_id);
  RETURN fn_venta_liberar_reservas_nucleo(p_venta_id);
END;
$$;

-- ── Consumir al despachar ────────────────────────────────────────────────────────────────────────────────────────────────
-- Rebaja de cada LPN anotado lo reservado y cierra la reserva. Devuelve el desglose para venta_item_despachos. Lo que falte
-- (ítem con más cantidad que lo anotado) lo completa el llamador con stock LIBRE.
CREATE OR REPLACE FUNCTION public.fn_venta_consumir_reservas(p_venta_item_id uuid)
RETURNS TABLE (linea_id uuid, lpn text, ubicacion_id uuid, ubicacion_nombre text, sucursal_id uuid, cantidad integer,
               talle text, color text, encaje text, formato text, sabor_aroma text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_item  RECORD;
  v_r     RECORD;
  v_l     RECORD;
  v_x     integer;
BEGIN
  SELECT vi.id, vi.tenant_id, v.sucursal_id, v.estado
    INTO v_item
    FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
   WHERE vi.id = p_venta_item_id
   FOR UPDATE OF v;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'Ítem de venta inexistente'; END IF;
  PERFORM fn_venta_reserva_check_acceso(v_item.tenant_id, v_item.sucursal_id);
  IF v_item.estado IN ('despachada', 'facturada', 'cancelada', 'devuelta') THEN
    RAISE EXCEPTION 'La venta está % — no se puede rebajar su reserva', v_item.estado;
  END IF;

  FOR v_r IN
    SELECT r.id, r.linea_id, r.cantidad FROM venta_item_reservas r
     WHERE r.venta_item_id = p_venta_item_id
     ORDER BY r.created_at
  LOOP
    -- Mismo orden de locks que fn_venta_reservar_linea: primero el LPN, después la anotación.
    SELECT il.id, il.lpn, il.ubicacion_id, u.nombre AS ubic_nombre, il.sucursal_id, il.cantidad,
           il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
      INTO v_l
      FROM inventario_lineas il LEFT JOIN ubicaciones u ON u.id = il.ubicacion_id
     WHERE il.id = v_r.linea_id
     FOR UPDATE OF il;

    -- Primero se cierra la reserva (el trigger baja cantidad_reservada) y DESPUÉS se rebaja la cantidad: al revés violaría
    -- chk_cantidad_mayor_o_igual_reservada (cantidad >= cantidad_reservada).
    DELETE FROM venta_item_reservas WHERE id = v_r.id;

    v_x := LEAST(v_r.cantidad, GREATEST(COALESCE(v_l.cantidad, 0), 0));
    IF v_x > 0 THEN
      -- Sigue activo si le queda stock o si todavía tiene reservas de otras ventas.
      UPDATE inventario_lineas
         SET cantidad = cantidad - v_x,
             activo = (cantidad - v_x) > 0 OR COALESCE(cantidad_reservada, 0) > 0
       WHERE id = v_r.linea_id;

      linea_id := v_l.id; lpn := v_l.lpn; ubicacion_id := v_l.ubicacion_id; ubicacion_nombre := v_l.ubic_nombre;
      sucursal_id := v_l.sucursal_id; cantidad := v_x;
      talle := v_l.talle; color := v_l.color; encaje := v_l.encaje; formato := v_l.formato; sabor_aroma := v_l.sabor_aroma;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_venta_item_reserva_al_borrar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_venta_liberar_reservas_nucleo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_venta_reserva_check_acceso(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_venta_reservar_linea(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_venta_liberar_reservas(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_venta_consumir_reservas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_venta_liberar_reservas_nucleo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_venta_reserva_check_acceso(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_venta_reservar_linea(uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_venta_liberar_reservas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_venta_consumir_reservas(uuid) TO authenticated, service_role;

-- ── Vencimiento automático: liberar lo de ESA venta ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liberar_reservas_vencidas(p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dias       INTEGER;
  v_penal_pct  NUMERIC;
  v_count      INTEGER := 0;
  r            RECORD;
  it           RECORD;
  v_acreditar  NUMERIC;
BEGIN
  -- 🔒 mig 437: un usuario solo puede liberar las reservas de SU negocio. Sin usuario (auth.uid()
  -- NULL) es el sweep de service_role vía liberar_reservas_vencidas_all(): pasa.
  IF auth.uid() IS NOT NULL AND p_tenant_id IS DISTINCT FROM get_user_tenant_id() THEN
    RETURN 0;
  END IF;

  SELECT reserva_vencimiento_dias, COALESCE(reserva_penalidad_pct, 0)
    INTO v_dias, v_penal_pct
    FROM tenants WHERE id = p_tenant_id;
  IF v_dias IS NULL OR v_dias <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, cliente_id, COALESCE(monto_pagado, 0) AS monto_pagado, numero
    FROM ventas
    WHERE tenant_id = p_tenant_id
      AND estado = 'reservada'
      AND COALESCE(reservado_at, updated_at) < NOW() - (v_dias * INTERVAL '1 day')
  LOOP
    BEGIN
      -- Series: igual que antes.
      FOR it IN
        SELECT vi.id AS item_id FROM venta_items vi JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = r.id AND p.tiene_series
      LOOP
        UPDATE inventario_series
          SET reservado = false
          WHERE id IN (SELECT serie_id FROM venta_series WHERE venta_item_id = it.item_id);
      END LOOP;
      -- Mig 488: el resto, solo lo que reservó ESTA venta (antes: las primeras reservas del producto, de cualquiera).
      -- Núcleo sin chequeo de sucursal: el vencimiento es del negocio (como antes), lo dispare quien lo dispare.
      PERFORM fn_venta_liberar_reservas_nucleo(r.id);

      IF r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL THEN
        v_acreditar := round((GREATEST(0, r.monto_pagado * (1 - v_penal_pct / 100.0)))::numeric, 2);
        IF v_acreditar > 0.01 THEN
          INSERT INTO cliente_creditos (tenant_id, cliente_id, monto, origen, venta_id, nota)
          VALUES (p_tenant_id, r.cliente_id, v_acreditar, 'reserva_vencida', r.id,
            'Reserva vencida #' || COALESCE(r.numero::text, '?') ||
            CASE WHEN v_penal_pct > 0 THEN ' (penalidad ' || v_penal_pct || '%)' ELSE '' END);
        END IF;
      END IF;

      UPDATE ventas
        SET estado = 'cancelada',
            cancelado_at = NOW(),
            notas = COALESCE(notas, '') || ' · [Reserva vencida: stock liberado automaticamente el '
                    || to_char(NOW(), 'DD/MM/YYYY')
                    || CASE WHEN r.monto_pagado > 0.01 AND r.cliente_id IS NOT NULL
                            THEN '; seña acreditada al cliente' ELSE '' END || ']'
        WHERE id = r.id;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── Deshacer el lanzamiento / cancelar un pedido de VENTA no toca la reserva de la venta ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pedido_liberar_tareas_pendientes(p_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tarea RECORD;
  v_de_venta boolean;
BEGIN
  PERFORM 1 FROM wms_tareas WHERE pedido_id = p_pedido_id FOR UPDATE;
  -- Mig 488: en un pedido que nació de una venta el picking nunca reservó (mig 316): la reserva es de la VENTA y se libera
  -- (o no) con la venta. Antes se descontaba igual y quedaba la venta reservada sin stock reservado.
  SELECT (venta_origen_id IS NOT NULL) INTO v_de_venta FROM pedidos WHERE id = p_pedido_id;

  FOR v_tarea IN
    SELECT * FROM wms_tareas WHERE pedido_id = p_pedido_id AND estado IN ('pendiente', 'en_curso')
  LOOP
    IF v_tarea.lpn_origen IS NOT NULL AND NOT COALESCE(v_de_venta, false) THEN
      UPDATE inventario_lineas SET cantidad_reservada = GREATEST(0, cantidad_reservada - v_tarea.cantidad)
      WHERE tenant_id = v_tarea.tenant_id AND producto_id = v_tarea.producto_id
        AND ubicacion_id = v_tarea.ubicacion_origen_id AND lpn = v_tarea.lpn_origen AND activo = true;
    END IF;
    UPDATE wms_tareas SET estado = 'cancelada',
      notas = COALESCE(notas || ' — ', '') || 'Cancelada: se deshizo el lanzamiento del pedido'
    WHERE id = v_tarea.id;
  END LOOP;
END;
$function$;

-- ── Des-pickear en un pedido de VENTA: la reserva (y su anotación) viajan al LPN nuevo ───────────────────────────────────
-- Helper: pasa hasta p_cantidad de lo anotado por la venta en p_linea_origen a p_linea_destino, sin disparar el trigger de
-- liberación (UPDATE, no DELETE). Las cantidades reservadas de los LPN las ajusta el llamador.
CREATE OR REPLACE FUNCTION public.fn_venta_reservas_mover_anotacion(p_venta_id uuid, p_linea_origen uuid, p_linea_destino uuid, p_cantidad integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_r    RECORD;
  v_rest integer := p_cantidad;
  v_t    integer;
BEGIN
  FOR v_r IN
    SELECT id, venta_item_id, tenant_id, producto_id, cantidad FROM venta_item_reservas
     WHERE venta_id = p_venta_id AND linea_id = p_linea_origen
     ORDER BY created_at FOR UPDATE
  LOOP
    EXIT WHEN v_rest <= 0;
    v_t := LEAST(v_rest, v_r.cantidad);
    IF v_t = v_r.cantidad THEN
      UPDATE venta_item_reservas SET linea_id = p_linea_destino WHERE id = v_r.id;
    ELSE
      UPDATE venta_item_reservas SET cantidad = cantidad - v_t WHERE id = v_r.id;
      INSERT INTO venta_item_reservas (tenant_id, venta_id, venta_item_id, linea_id, producto_id, cantidad)
      VALUES (v_r.tenant_id, p_venta_id, v_r.venta_item_id, p_linea_destino, v_r.producto_id, v_t)
      ON CONFLICT (venta_item_id, linea_id) DO UPDATE SET cantidad = venta_item_reservas.cantidad + EXCLUDED.cantidad;
    END IF;
    v_rest := v_rest - v_t;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_venta_reservas_mover_anotacion(uuid, uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_venta_reservas_mover_anotacion(uuid, uuid, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_unpick_tarea_wms(p_tarea_id uuid, p_ubicacion_destino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tarea      RECORD;
  v_pedido     RECORD;
  v_linea      RECORD;
  v_nuevo_lpn  text;
  v_nueva_id   uuid;
  v_restante   integer;
  v_tomar      integer;
BEGIN
  SELECT * INTO v_tarea FROM wms_tareas WHERE id = p_tarea_id FOR UPDATE;
  IF v_tarea IS NULL THEN RAISE EXCEPTION 'Tarea inexistente o sin permisos'; END IF;
  IF v_tarea.tipo <> 'picking' THEN RAISE EXCEPTION 'Solo se puede deshacer (des-pickear) una tarea de picking'; END IF;
  IF v_tarea.estado <> 'completada' THEN RAISE EXCEPTION 'Esta tarea no está completada'; END IF;
  IF v_tarea.pedido_id IS NULL THEN RAISE EXCEPTION 'El des-pickeo solo está disponible para tareas originadas en un Pedido'; END IF;
  IF p_ubicacion_destino_id IS NULL THEN RAISE EXCEPTION 'Elegí una ubicación destino para reubicar el LPN'; END IF;

  SELECT * INTO v_pedido FROM pedidos WHERE id = v_tarea.pedido_id FOR UPDATE;
  IF v_pedido.estado IN ('entregado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido ya está % — no se puede deshacer el picking', v_pedido.estado;
  END IF;

  v_restante := v_tarea.cantidad;

  FOR v_linea IN
    SELECT il.id, il.cantidad, il.cantidad_reservada, il.estado_id, il.nro_lote, il.fecha_vencimiento,
           il.pais_origen, il.proveedor_id, il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
    FROM inventario_lineas il
    WHERE il.tenant_id = v_tarea.tenant_id AND il.producto_id = v_tarea.producto_id
      AND il.ubicacion_id = v_tarea.ubicacion_origen_id AND il.lpn = v_tarea.lpn_origen
      AND il.activo = true
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
    IF v_tomar <= 0 THEN CONTINUE; END IF;

    UPDATE inventario_lineas SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
      activo = (cantidad - v_tomar) > 0 WHERE id = v_linea.id;

    v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    -- Mig 488: en un pedido de VENTA lo des-pickeado sigue reservado para esa venta (antes quedaba libre y la venta
    -- reservada se quedaba sin stock reservado).
    INSERT INTO inventario_lineas
      (tenant_id, producto_id, lpn, cantidad, cantidad_reservada, estado_id, ubicacion_id, sucursal_id, proveedor_id,
       nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
    VALUES
      (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar,
       CASE WHEN v_pedido.venta_origen_id IS NOT NULL THEN v_tomar ELSE 0 END,
       v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
       v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma)
    RETURNING id INTO v_nueva_id;
    IF v_pedido.venta_origen_id IS NOT NULL THEN
      PERFORM fn_venta_reservas_mover_anotacion(v_pedido.venta_origen_id, v_linea.id, v_nueva_id, v_tomar);
    END IF;

    v_restante := v_restante - v_tomar;
  END LOOP;

  IF v_restante > 0 AND v_tarea.tarea_precedente_id IS NOT NULL THEN
    FOR v_linea IN
      SELECT il.id, il.cantidad, il.cantidad_reservada, il.estado_id, il.nro_lote, il.fecha_vencimiento,
             il.pais_origen, il.proveedor_id, il.talle, il.color, il.encaje, il.formato, il.sabor_aroma
      FROM inventario_lineas il
      WHERE il.tenant_id = v_tarea.tenant_id AND il.producto_id = v_tarea.producto_id
        AND il.ubicacion_id = v_tarea.ubicacion_origen_id
        AND il.activo = true AND COALESCE(il.cantidad_reservada, 0) > 0
      ORDER BY il.fecha_vencimiento NULLS LAST, il.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_restante <= 0;
      v_tomar := LEAST(v_restante, v_linea.cantidad_reservada);
      IF v_tomar <= 0 THEN CONTINUE; END IF;

      UPDATE inventario_lineas SET cantidad = cantidad - v_tomar, cantidad_reservada = cantidad_reservada - v_tomar,
        activo = (cantidad - v_tomar) > 0 WHERE id = v_linea.id;

      v_nuevo_lpn := 'LPN-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      INSERT INTO inventario_lineas
        (tenant_id, producto_id, lpn, cantidad, cantidad_reservada, estado_id, ubicacion_id, sucursal_id, proveedor_id,
         nro_lote, fecha_vencimiento, pais_origen, talle, color, encaje, formato, sabor_aroma)
      VALUES
        (v_tarea.tenant_id, v_tarea.producto_id, v_nuevo_lpn, v_tomar,
         CASE WHEN v_pedido.venta_origen_id IS NOT NULL THEN v_tomar ELSE 0 END,
         v_linea.estado_id, p_ubicacion_destino_id, v_tarea.sucursal_id, v_linea.proveedor_id,
         v_linea.nro_lote, v_linea.fecha_vencimiento, v_linea.pais_origen, v_linea.talle, v_linea.color, v_linea.encaje, v_linea.formato, v_linea.sabor_aroma)
      RETURNING id INTO v_nueva_id;
      IF v_pedido.venta_origen_id IS NOT NULL THEN
        PERFORM fn_venta_reservas_mover_anotacion(v_pedido.venta_origen_id, v_linea.id, v_nueva_id, v_tomar);
      END IF;

      v_restante := v_restante - v_tomar;
    END LOOP;
  END IF;

  IF v_restante > 0 THEN
    IF v_tarea.tarea_precedente_id IS NOT NULL THEN
      RAISE EXCEPTION 'No se encontró stock reservado suficiente del producto en la ubicación de picking para des-pickear esta tarea — puede que ya se haya generado la venta';
    ELSE
      RAISE EXCEPTION 'No se encontró el LPN reservado (%) — puede que ya se haya generado la venta o se haya movido de otra forma', v_tarea.lpn_origen;
    END IF;
  END IF;

  UPDATE wms_tareas SET estado = 'cancelada',
    notas = COALESCE(notas || ' — ', '') || 'Des-pickeado: reubicado en otra ubicación'
  WHERE id = p_tarea_id;
END;
$function$;

-- ── Backfill: anotar las reservas vivas ──────────────────────────────────────────────────────────────────────────────────
-- Para cada ítem (sin serie) de una venta 'reservada' sin anotar: repartir su cantidad entre los LPN con reserva del mismo
-- producto (y sucursal de la venta), sin pasarse de lo que cada LPN tiene reservado y todavía no está anotado. No modifica
-- ningún LPN (insert directo, sin la función). Si cubrió el ítem completo se marca `reserva_anotada`; si no, queda sin
-- marcar y el remanente se libera por el camino de compatibilidad.
LOCK TABLE public.inventario_lineas IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  v_it   RECORD;
  v_ln   RECORD;
  v_rest numeric;
  v_x    numeric;
BEGIN
  FOR v_it IN
    SELECT vi.id, vi.tenant_id, vi.venta_id, vi.producto_id, vi.cantidad, v.sucursal_id
      FROM venta_items vi
      JOIN ventas v ON v.id = vi.venta_id
      JOIN productos p ON p.id = vi.producto_id
     WHERE v.estado = 'reservada' AND NOT COALESCE(p.tiene_series, false) AND vi.cantidad > 0
       AND NOT vi.reserva_anotada
       AND NOT EXISTS (SELECT 1 FROM venta_item_reservas r WHERE r.venta_item_id = vi.id)
     ORDER BY v.reservado_at NULLS LAST, v.created_at, vi.id
  LOOP
    v_rest := v_it.cantidad;
    FOR v_ln IN
      SELECT il.id,
             COALESCE(il.cantidad_reservada, 0)
               - COALESCE((SELECT SUM(r.cantidad) FROM venta_item_reservas r WHERE r.linea_id = il.id), 0) AS sin_anotar
        FROM inventario_lineas il
       WHERE il.tenant_id = v_it.tenant_id AND il.producto_id = v_it.producto_id AND il.activo
         AND COALESCE(il.cantidad_reservada, 0) > 0
         AND (v_it.sucursal_id IS NULL OR il.sucursal_id IS NULL OR il.sucursal_id = v_it.sucursal_id)
       ORDER BY il.created_at
    LOOP
      EXIT WHEN v_rest <= 0;
      v_x := FLOOR(LEAST(v_rest, v_ln.sin_anotar));
      IF v_x <= 0 THEN CONTINUE; END IF;
      INSERT INTO venta_item_reservas (tenant_id, venta_id, venta_item_id, linea_id, producto_id, cantidad)
      VALUES (v_it.tenant_id, v_it.venta_id, v_it.id, v_ln.id, v_it.producto_id, v_x::integer)
      ON CONFLICT (venta_item_id, linea_id) DO UPDATE SET cantidad = venta_item_reservas.cantidad + EXCLUDED.cantidad;
      v_rest := v_rest - v_x;
    END LOOP;
    IF v_rest <= 0 THEN
      UPDATE venta_items SET reserva_anotada = true WHERE id = v_it.id;
    END IF;
  END LOOP;
END $$;
