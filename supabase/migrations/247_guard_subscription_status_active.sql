-- 247 — Guard server-side: subscription_status='active' solo lo activa el servidor.
--
-- REGLA #0 (billing): el fallback del cliente en SuscripcionPage activaba la
-- suscripción con un simple UPDATE desde el navegador a partir del redirect de MP
-- (`?status=approved&preapproval_id=X`), SIN verificar el pago. Cualquier usuario
-- podía auto-activarse (o bypassear la UI con un PATCH directo a PostgREST).
--
-- La verificación real ahora vive en la EF `mp-verificar-suscripcion` (consulta el
-- preapproval contra la API de MP) y en el webhook `mp-webhook`, ambos service_role.
-- Este trigger es el guard server-side (ADEMÁS de la UI): impide que un cliente
-- autenticado lleve `subscription_status` a 'active'. Permitido solo para:
--   - service_role  → webhook / EF de pago verificado
--   - rol 'ADMIN'   → staff de Genesis360 (AdminPage; los tenants NO pueden
--                     auto-asignarse el rol ADMIN, sus roles son DUEÑO/SUPERVISOR/…)
-- Otras transiciones (a 'cancelled', 'trial', etc.) NO se tocan: cancelar desde
-- "Mi cuenta" sigue funcionando.

CREATE OR REPLACE FUNCTION public.guard_subscription_status_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_status = 'active'
     AND NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    IF auth.role() <> 'service_role'
       AND coalesce(public.get_user_role(), '') <> 'ADMIN' THEN
      RAISE EXCEPTION 'subscription_status=active solo lo activa el servidor con el pago verificado (no desde el cliente)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subscription_status_active ON public.tenants;
CREATE TRIGGER trg_guard_subscription_status_active
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  WHEN (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status)
  EXECUTE FUNCTION public.guard_subscription_status_active();
