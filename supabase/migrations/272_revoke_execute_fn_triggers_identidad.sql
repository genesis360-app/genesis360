-- 272: REVOKE EXECUTE de las funciones de trigger de la mig 271 (hallazgo del Security Advisor).
--
-- `fn_espejo_emisor_default_a_tenant` y `fn_guard_emisor_default` son SECURITY DEFINER y, por el
-- EXECUTE que PostgreSQL otorga a PUBLIC por default, quedaron invocables por `anon` y
-- `authenticated` vía `/rest/v1/rpc/...`. Un trigger NO necesita que nadie pueda llamarlo por
-- REST: el EXECUTE se chequea al CREAR el trigger, no por fila en runtime → revocar es seguro y
-- los triggers siguen funcionando. (Mismo patrón que reference_revoke_public_no_anon: revocar de
-- PUBLIC, no solo de anon.)
REVOKE ALL ON FUNCTION public.fn_espejo_emisor_default_a_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_emisor_default() FROM PUBLIC, anon, authenticated;
