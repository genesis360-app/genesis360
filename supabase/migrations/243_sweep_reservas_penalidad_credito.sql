-- Migration 243 (v1.90.1) — #1: el sweep de reservas vencidas respeta `reserva_penalidad_pct`
-- y acredita la seña (menos la penalidad) al cliente, consistente con la cancelación MANUAL
-- (VentasPage cambiarEstado 'cancelada' → cliente_creditos origen 'cancelacion_reserva', spec 59).
--
-- Antes: el sweep cancelaba la reserva vencida y forfeit del 100% de la seña (inconsistente con el
-- flujo manual, que retiene la penalidad y acredita el resto). Ahora ambos caminos dan el mismo
-- resultado. La seña en efectivo ya está asentada en caja (ingreso_reserva); el crédito es un pasivo
-- (cliente_creditos), NO mueve caja. Sin cliente asignado → forfeit (no hay a quién acreditar).
-- REGLA #0 (plata): SECURITY DEFINER + search_path; error-isolado por reserva (no aborta el sweep).

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
  ln           RECORD;
  v_restante   NUMERIC;
  v_lib        NUMERIC;
  v_acreditar  NUMERIC;
BEGIN
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
      -- Liberar el stock reservado (series → reservado=false; resto → FIFO sobre cantidad_reservada)
      FOR it IN
        SELECT vi.id AS item_id, vi.producto_id, vi.cantidad, p.tiene_series
        FROM venta_items vi
        JOIN productos p ON p.id = vi.producto_id
        WHERE vi.venta_id = r.id
      LOOP
        IF it.tiene_series THEN
          UPDATE inventario_series
            SET reservado = false
            WHERE id IN (SELECT serie_id FROM venta_series WHERE venta_item_id = it.item_id);
        ELSE
          v_restante := it.cantidad;
          FOR ln IN
            SELECT id, cantidad_reservada FROM inventario_lineas
            WHERE producto_id = it.producto_id AND activo = true AND cantidad_reservada > 0
            ORDER BY created_at
          LOOP
            EXIT WHEN v_restante <= 0;
            v_lib := LEAST(ln.cantidad_reservada, v_restante);
            UPDATE inventario_lineas
              SET cantidad_reservada = cantidad_reservada - v_lib
              WHERE id = ln.id;
            v_restante := v_restante - v_lib;
          END LOOP;
        END IF;
      END LOOP;

      -- #1 — acreditar la seña menos la penalidad (solo si hay seña + cliente + saldo > 0)
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
