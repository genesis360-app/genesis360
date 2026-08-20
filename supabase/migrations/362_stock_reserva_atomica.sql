-- ============================================================
-- 362_stock_reserva_atomica.sql
-- 🛑 REGLA #0 (INVENTARIO) — cierra un hallazgo real de la auditoría de performance/calidad
-- (2026-08-14): 5 puntos del código (VentasPage.tsx ×3, tn-webhook, meli-webhook) reservan y
-- liberan stock leyendo `cantidad_reservada` del cliente, calculando el nuevo valor EN
-- JAVASCRIPT, y pisándolo con un `.update()` — un patrón leer-modificar-escribir NO atómico.
-- Dos operaciones concurrentes sobre la misma línea (una venta de mostrador + un webhook de
-- TN/MELI llegando junto, o dos webhooks en ráfaga) pueden pisarse una reserva sin que ningún
-- CHECK lo detecte — el valor final sigue siendo válido, solo que está mal.
--
-- Fix: dos RPCs chicas que hacen el ajuste server-side, con `SELECT ... FOR UPDATE` (lock de
-- fila) antes de calcular cuánto reservar/liberar — así dos transacciones concurrentes sobre
-- la MISMA línea quedan serializadas por Postgres en vez de pisarse. Reciben la cantidad
-- DESEADA (no un delta ya calculado en JS) y devuelven cuánto se aplicó realmente, clampeado
-- contra el estado real (y actual, no el leído hace unos milisegundos) de la línea — los 5
-- call sites pasan a usarlas en vez del `.update()` directo.
--
-- SECURITY INVOKER (default, sin `SECURITY DEFINER`) a propósito: el POS ya puede hacer este
-- UPDATE hoy porque el usuario autenticado tiene permiso vía RLS sobre `inventario_lineas` —
-- estas RPCs no necesitan elevar privilegios, solo atomizar la operación. Los webhooks (TN/
-- MELI) llaman con `service_role`, que bypassea RLS igual que hoy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reservar_stock_linea(p_linea_id uuid, p_cantidad numeric)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_disponible numeric;
  v_reservar   numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN 0; END IF;

  SELECT GREATEST(cantidad - cantidad_reservada, 0) INTO v_disponible
  FROM inventario_lineas WHERE id = p_linea_id FOR UPDATE;

  IF v_disponible IS NULL THEN RETURN 0; END IF; -- línea inexistente (no rompe al caller)

  v_reservar := LEAST(p_cantidad, v_disponible);
  IF v_reservar <= 0 THEN RETURN 0; END IF;
  -- `inventario_lineas.cantidad`/`cantidad_reservada` son integer — redondear ACÁ (antes de
  -- persistir) para que el valor devuelto sea exactamente el que quedó escrito. Sin esto, un
  -- p_cantidad fraccionario (el parámetro es numeric) se guardaría redondeado por el cast
  -- implícito del UPDATE pero se devolvería sin redondear — contrato roto (hallazgo del
  -- migration-reviewer).
  v_reservar := ROUND(v_reservar);

  UPDATE inventario_lineas SET cantidad_reservada = cantidad_reservada + v_reservar
  WHERE id = p_linea_id;

  RETURN v_reservar;
END;
$$;

COMMENT ON FUNCTION public.fn_reservar_stock_linea(uuid, numeric) IS
  'Reserva atómicamente hasta p_cantidad unidades de una línea de inventario (mig 362) — SELECT...FOR UPDATE + UPDATE relativo, en vez del patrón leer-en-JS-y-pisar que causaba pérdida de reservas bajo concurrencia. Devuelve cuánto se reservó realmente (puede ser menos que lo pedido, o 0).';

REVOKE ALL ON FUNCTION public.fn_reservar_stock_linea(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reservar_stock_linea(uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_liberar_stock_linea(p_linea_id uuid, p_cantidad numeric)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reservada numeric;
  v_liberar   numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RETURN 0; END IF;

  SELECT GREATEST(cantidad_reservada, 0) INTO v_reservada
  FROM inventario_lineas WHERE id = p_linea_id FOR UPDATE;

  IF v_reservada IS NULL THEN RETURN 0; END IF; -- línea inexistente (no rompe al caller)

  v_liberar := LEAST(p_cantidad, v_reservada);
  IF v_liberar <= 0 THEN RETURN 0; END IF;
  -- Ver comentario equivalente en fn_reservar_stock_linea.
  v_liberar := ROUND(v_liberar);

  UPDATE inventario_lineas SET cantidad_reservada = cantidad_reservada - v_liberar
  WHERE id = p_linea_id;

  RETURN v_liberar;
END;
$$;

COMMENT ON FUNCTION public.fn_liberar_stock_linea(uuid, numeric) IS
  'Libera atómicamente hasta p_cantidad unidades reservadas de una línea de inventario (mig 362) — mismo criterio que fn_reservar_stock_linea. Devuelve cuánto se liberó realmente.';

REVOKE ALL ON FUNCTION public.fn_liberar_stock_linea(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_liberar_stock_linea(uuid, numeric) TO authenticated, service_role;
