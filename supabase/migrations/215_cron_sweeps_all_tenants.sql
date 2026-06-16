-- ─── Migration 215: Sweeps "todos los tenants" para cron externo (issue #7) ───
-- Hoy los sweeps (intereses CC + reservas vencidas) corren solo de forma lazy al abrir
-- la página correcta (pg_cron no está habilitado — ver reference_pg_cron_no_habilitado).
-- Estos wrappers SECURITY DEFINER barren TODOS los tenants y los invoca la Edge Function
-- `cron-sweeps` (service_role) disparada por GitHub Actions a diario.
--
-- NOTA: los servicios recurrentes (que generan GASTOS) se dejan ASISTIDOS a propósito
-- (igual que ventas_recurrentes): crear comprobantes financieros por cron sin revisión
-- es indeseable. Solo se cronean los dos sweeps idempotentes y no-financieros.

-- Reservas vencidas: la función por-tenant NO chequea auth.uid() → se puede loopear y llamar.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas_all()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total INT := 0;
  v_n     INT;
  t       RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    v_n := liberar_reservas_vencidas(t.id);
    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;
  RETURN v_total;
END;
$$;

-- Intereses CC: la función por-tenant exige auth.uid() del tenant (pensada para el frontend),
-- así que no se puede loop-llamar desde service_role. Replicamos su lógica (mig 172) por tenant.
CREATE OR REPLACE FUNCTION recalcular_intereses_cc_all()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total INT := 0;
  v_count INT;
  v_pct   NUMERIC;
  t       RECORD;
BEGIN
  FOR t IN SELECT id, COALESCE(cc_interes_mensual_pct, 0) AS pct FROM tenants LOOP
    v_pct := t.pct;
    IF v_pct IS NULL OR v_pct <= 0 THEN
      -- Sin interés configurado: limpiar cualquier interés previo del tenant.
      UPDATE ventas SET interes_cc = 0
        WHERE tenant_id = t.id AND es_cuenta_corriente = TRUE AND interes_cc <> 0;
      CONTINUE;
    END IF;

    UPDATE ventas v SET interes_cc = ROUND(
        GREATEST(v.total - v.monto_pagado, 0)
        * (v_pct / 100.0)
        * (GREATEST(0, (CURRENT_DATE - v.fecha_vencimiento_cc)) / 30.0)
      , 2)
    WHERE v.tenant_id = t.id
      AND v.es_cuenta_corriente = TRUE
      AND v.estado <> 'cancelada'
      AND v.fecha_vencimiento_cc IS NOT NULL
      AND (v.total - v.monto_pagado) > 0.5;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;

    -- Ventas saldadas o no vencidas: interés en 0.
    UPDATE ventas SET interes_cc = 0
      WHERE tenant_id = t.id AND es_cuenta_corriente = TRUE AND interes_cc <> 0
        AND ((total - monto_pagado) <= 0.5
             OR fecha_vencimiento_cc IS NULL
             OR fecha_vencimiento_cc >= CURRENT_DATE);
  END LOOP;
  RETURN v_total;
END;
$$;

-- Solo service_role (la Edge Function cron-sweeps): nunca PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION liberar_reservas_vencidas_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION recalcular_intereses_cc_all()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION liberar_reservas_vencidas_all() TO service_role;
GRANT EXECUTE ON FUNCTION recalcular_intereses_cc_all()  TO service_role;
