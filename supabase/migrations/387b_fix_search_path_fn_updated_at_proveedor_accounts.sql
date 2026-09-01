-- 387b: fix del advisor function_search_path_mutable sobre la función recién creada en 387.
CREATE OR REPLACE FUNCTION public.fn_updated_at_proveedor_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
