-- 255_subscription_period_end.sql
-- MP-C9 — Grace period al cancelar la suscripción (REGLA #0, fairness).
--
-- Cuando un usuario cancela una suscripción PAGA, MP deja de cobrar pero el período
-- ya pagado le corresponde: el acceso debe perdurar hasta el fin de ese período
-- (~30 días desde el último pago). Guardamos esa fecha de corte al cancelar y el
-- SubscriptionGuard la respeta (cancelled + now < subscription_period_end → acceso).
--
-- Aditiva/idempotente. Tenants existentes quedan NULL (sin grace retroactivo — correcto:
-- solo las cancelaciones nuevas registran su fecha de corte).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_period_end timestamptz;

COMMENT ON COLUMN public.tenants.subscription_period_end IS
  'MP-C9: fin del período pagado. Se setea al cancelar una sub activa (next_payment_date de MP, fallback now()+30d). El acceso se mantiene hasta esta fecha aunque subscription_status=cancelled.';
