-- 387c: proveedor_accounts nunca tuvo REVOKE ALL FROM authenticated antes de otorgar
-- SELECT/UPDATE — a diferencia de proveedor_account_tenants, que sí lo hizo. Sin impacto real
-- (RLS ya bloquea INSERT/DELETE de authenticated al no haber policy para esos comandos), pero se
-- deja explícito para que el estado de GRANTs no contradiga lo que las policies permiten.
REVOKE ALL ON public.proveedor_accounts FROM authenticated;
GRANT SELECT, UPDATE ON public.proveedor_accounts TO authenticated;
