-- 234 — Guard server-side de Cuenta Corriente en la venta (REGLA #0 obligación #3: guards server además de UI).
--
-- Contexto: el enforcement de límite de CC (B1) y morosidad (B4) vivía SOLO en el frontend
-- (VentasPage.registrarVenta + src/lib/ccLogic.ts). Ante bundle cacheado o escritura por API/service-role,
-- esos topes se saltaban. Este trigger los replica server-side (defense-in-depth) sobre el INSERT de ventas.
--
-- Decisiones de fidelidad con el cliente (para NO bloquear ventas legítimas):
--   - Solo HARD-BLOCK lo que el cliente bloquea: morosidad 'bloqueo_total' (cualquier venta no-presupuesto)
--     / 'bloqueo_cc' (solo ventas CC); límite con política 'bloquear' (NO 'avisar' — eso es un confirm de UX).
--   - montoCC = suma de los medios 'Cuenta Corriente' en medio_pago (JSON), NO total-monto_pagado
--     (el crédito a favor y el envío lo distorsionan) — espeja VentasPage.tsx (montoCC).
--   - Presupuesto (estado 'pendiente') o venta sin cliente: no aplica.
--   - EPS = 0.5 (tolerancia de redondeo transversal, igual que ccLogic.EPS_CC).
--   - La deuda del cliente se computa INLINE scopeada por NEW.tenant_id (NO vía cliente_cc_estado, que
--     filtra por auth.uid() y devuelve 0 en contextos sin sesión → el guard se saltaría). La math de la
--     deuda espeja exactamente cliente_cc_estado (mig 172).
--   - Defensivo: si medio_pago no es JSON válido, montoCC=0 (no bloquear por límite; el cliente ya valida).
--
-- BEFORE INSERT (donde el cliente crea la CC). Verificado en DEV con 8 escenarios (S1-S8) — todos verdes.

CREATE OR REPLACE FUNCTION public.fn_ventas_cc_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_eps         numeric := 0.5;
  v_es_cc       boolean := COALESCE(NEW.es_cuenta_corriente, false);
  v_monto_cc    numeric := 0;
  v_deuda_total numeric := 0;
  v_deuda_venc  numeric := 0;
  v_limite      numeric;
  v_enf         text;
  v_moros       text;
BEGIN
  IF NEW.estado = 'pendiente' OR NEW.cliente_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_moros := COALESCE((SELECT cc_morosidad_politica FROM public.tenants WHERE id = NEW.tenant_id), 'bloqueo_cc');

  IF NOT (v_es_cc OR v_moros = 'bloqueo_total') THEN
    RETURN NEW;
  END IF;

  -- Deuda del cliente ANTES de esta venta (BEFORE INSERT → NEW aún no está en la tabla).
  -- Espeja cliente_cc_estado pero scopeada por NEW.tenant_id (independiente de auth.uid()).
  SELECT
    COALESCE(SUM(GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0)), 0),
    COALESCE(SUM(CASE WHEN v.fecha_vencimiento_cc IS NOT NULL AND v.fecha_vencimiento_cc < CURRENT_DATE
                      THEN GREATEST(v.total - v.monto_pagado, 0) + COALESCE(v.interes_cc, 0) ELSE 0 END), 0)
    INTO v_deuda_total, v_deuda_venc
    FROM public.ventas v
    WHERE v.cliente_id = NEW.cliente_id
      AND v.tenant_id = NEW.tenant_id
      AND v.es_cuenta_corriente = TRUE
      AND v.estado <> 'cancelada'
      AND (v.total - v.monto_pagado) > v_eps;

  -- B4 — morosidad.
  IF v_deuda_venc > v_eps THEN
    IF v_moros = 'bloqueo_total' THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede comprar hasta saldar.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    ELSIF v_moros = 'bloqueo_cc' AND v_es_cc THEN
      RAISE EXCEPTION 'Cliente con deuda vencida ($%). No puede sumar a cuenta corriente; cobrá por otro medio.', round(v_deuda_venc)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- B1 — límite (parte CC, solo si la política es 'bloquear').
  IF v_es_cc THEN
    BEGIN
      IF NEW.medio_pago IS NOT NULL AND btrim(NEW.medio_pago) <> '' THEN
        SELECT COALESCE(SUM((e->>'monto')::numeric), 0) INTO v_monto_cc
          FROM jsonb_array_elements(NEW.medio_pago::jsonb) e
          WHERE e->>'tipo' = 'Cuenta Corriente';
      END IF;
    EXCEPTION WHEN others THEN
      v_monto_cc := 0;
    END;

    IF v_monto_cc > v_eps THEN
      v_enf := COALESCE((SELECT cc_enforcement_politica FROM public.tenants WHERE id = NEW.tenant_id), 'avisar');
      IF v_enf = 'bloquear' THEN
        SELECT COALESCE(c.limite_credito, t.limite_cc_default)
          INTO v_limite
          FROM public.clientes c, public.tenants t
          WHERE c.id = NEW.cliente_id AND t.id = NEW.tenant_id;
        IF v_limite IS NOT NULL AND (v_deuda_total + v_monto_cc) > v_limite + v_eps THEN
          RAISE EXCEPTION 'La venta deja la cuenta corriente en $% y supera el límite de $%. Operación bloqueada.',
            round(v_deuda_total + v_monto_cc), round(v_limite)
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_ventas_cc_guard ON public.ventas;
CREATE TRIGGER trg_ventas_cc_guard
  BEFORE INSERT ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.fn_ventas_cc_guard();
