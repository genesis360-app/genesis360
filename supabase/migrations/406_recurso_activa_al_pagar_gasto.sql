-- 406 — Un recurso pendiente pasa a ACTIVO cuando se paga su gasto de adquisición
--
-- Pedido de Fede (2026-09-08), issues #12/#13 del módulo de Recursos:
--
--   > "Al crearse un recurso pendiente de gastos debería aparecer en recursos pendientes, una vez
--   >  validado el pago desde el módulo de gastos pasaría a recursos activos, si no necesita
--   >  validarse en gastos aparece directo en recursos activos."
--
-- El alta del recurso ya quedó resuelta en el frontend (nace en `pendiente_adquisicion` cuando
-- genera un gasto, y el gasto nace en `estado_pago = 'pendiente'` en vez del default 'pagado'). Lo
-- que falta es el otro extremo del ciclo: **quién lo pasa a activo**.
--
-- Va como TRIGGER y no en `GastosPage` a propósito: un gasto se puede saldar por varios caminos
-- (el alta del pago, la edición del gasto, el pago de una OC, un sweep). Si la transición viviera
-- en una sola pantalla, cualquier otro camino dejaría el recurso colgado en "pendientes" para
-- siempre, y el usuario no tendría cómo darse cuenta.
--
-- Acotado a propósito:
--   · Solo actúa si el gasto tiene `recurso_id` (los gastos comunes no tocan nada).
--   · Solo en la TRANSICIÓN a 'pagado' (`OLD.estado_pago IS DISTINCT FROM 'pagado'`), así reeditar
--     un gasto ya pagado no vuelve a escribir.
--   · Solo levanta recursos en `pendiente_adquisicion`. Uno `dado_de_baja` o `en_reparacion` NO se
--     "revive" por pagar un gasto: sería pisar una decisión del usuario con un efecto colateral.
--   · No hace el camino inverso: despagar un gasto no devuelve el recurso a pendiente. Si un día se
--     quiere, es una decisión de negocio aparte — revertir un estado que alguien pudo haber tocado
--     a mano es justo el tipo de efecto silencioso que conviene no inventar.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recurso_activar_al_pagar_gasto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.recurso_id IS NOT NULL
     AND NEW.estado_pago = 'pagado'
     AND OLD.estado_pago IS DISTINCT FROM 'pagado' THEN
    UPDATE public.recursos
       SET estado = 'activo'
     WHERE id = NEW.recurso_id
       AND tenant_id = NEW.tenant_id
       AND estado = 'pendiente_adquisicion';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_recurso_activar_al_pagar_gasto() IS
  'Cierra el ciclo del módulo Recursos (mig 406): al saldar el gasto de adquisición, el recurso '
  'pasa de pendiente_adquisicion a activo. Solo en la transición a pagado y solo sobre recursos '
  'pendientes — nunca revive uno dado de baja.';

DROP TRIGGER IF EXISTS trg_recurso_activar_al_pagar_gasto ON public.gastos;
CREATE TRIGGER trg_recurso_activar_al_pagar_gasto
  AFTER UPDATE OF estado_pago ON public.gastos
  FOR EACH ROW EXECUTE FUNCTION public.fn_recurso_activar_al_pagar_gasto();

COMMIT;
