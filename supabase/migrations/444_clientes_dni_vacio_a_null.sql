-- 444 — DNI vacío del cliente → NULL (siempre, por cualquier camino)
--
-- El índice único `clientes_dni_tenant (tenant_id, dni) WHERE dni IS NOT NULL` (mig 028) trata '' como un valor. El alta
-- rápida del POS y la ficha insertaban `dni: ''` cuando no se completaba → el 2º cliente sin DNI del mismo negocio
-- fallaba con "Ya existe un cliente con ese DNI". En PROD había 2 negocios con un cliente con dni = '' (2026-09-30), o
-- sea con la próxima alta sin DNI rota. Pasa a importar ahora porque la ficha deja de exigir DNI cuando hay CUIT (GO).
--
-- 1) Normaliza lo existente ('' / solo espacios → NULL). No es un dato fiscal ni contable: un DNI vacío no identifica a
--    nadie, y NULL es lo que el índice y el resto del sistema entienden por "sin DNI".
-- 2) Trigger BEFORE INSERT/UPDATE: normaliza en el servidor, cubra o no el camino la UI (POS, ficha, importador, API).
--    SECURITY INVOKER (default): solo toca NEW, no lee otras tablas.

UPDATE public.clientes SET dni = NULL WHERE dni IS NOT NULL AND btrim(dni) = '';

CREATE OR REPLACE FUNCTION public.fn_clientes_dni_vacio_a_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.dni IS NOT NULL THEN
    NEW.dni := NULLIF(btrim(NEW.dni), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_dni_vacio_a_null ON public.clientes;
CREATE TRIGGER trg_clientes_dni_vacio_a_null
  BEFORE INSERT OR UPDATE OF dni ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.fn_clientes_dni_vacio_a_null();
