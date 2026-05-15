-- Fix: fn_crear_caja_fuerte falla con RLS al registrar un nuevo negocio.
-- El trigger corre antes de que el user exista en la tabla users, por lo que
-- la policy de cajas (tenant_id IN users) no puede resolverse.
-- Solución: SECURITY DEFINER para que el INSERT omita RLS.

CREATE OR REPLACE FUNCTION fn_crear_caja_fuerte()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte, activo)
  VALUES (NEW.id, 'Caja Fuerte / Bóveda', true, true);
  RETURN NEW;
END;
$$;
