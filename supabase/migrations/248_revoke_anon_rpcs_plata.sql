-- 248 — Least-privilege: revocar EXECUTE de `anon` en RPCs sensibles (plata/config).
--
-- Hallazgo (REGLA #0): por los DEFAULT PRIVILEGES de Supabase, las funciones nuevas
-- de `public` quedan con EXECUTE para `anon` (revocar de PUBLIC NO alcanza — ver
-- mig 246 / 208). Estos RPCs son SECURITY DEFINER y mueven plata / cambian config,
-- así que `anon` jamás debe poder invocarlos (su seguridad real son los checks de
-- rol+clave internos, pero least-privilege = no exponerlos a un rol sin sesión).
--
-- NO se tocan las funciones SECURITY DEFINER que SÍ son públicas a propósito
-- (páginas por token de envío/cuenta, fichado QR) ni los helpers usados dentro de
-- policies RLS (get_user_*, is_admin, auth_*): revocarles anon rompería el RLS.
--
-- RPCs llamados por el cliente AUTENTICADO (mantienen authenticated + service_role):
--   marcar_incobrable, registrar_pago_oc, marcar_envios_pagados, set_clave_maestra
REVOKE EXECUTE ON FUNCTION public.marcar_incobrable(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.marcar_incobrable(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_oc(uuid, jsonb, numeric, text, uuid, jsonb, integer, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.marcar_envios_pagados(uuid[], text, text, date, uuid, boolean, numeric, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.marcar_envios_pagados(uuid[], text, text, date, uuid, boolean, numeric, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_clave_maestra(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_clave_maestra(text) TO authenticated, service_role;

-- Sweeps cross-tenant: SOLO los llama la EF `cron-sweeps` con service_role.
-- No los necesita ni anon ni authenticated → least-privilege a service_role.
REVOKE EXECUTE ON FUNCTION public.liberar_reservas_vencidas_all() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.liberar_reservas_vencidas_all() TO service_role;

REVOKE EXECUTE ON FUNCTION public.recalcular_intereses_cc_all() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recalcular_intereses_cc_all() TO service_role;
