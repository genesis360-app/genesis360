-- Fix: generar numero de venta automáticamente por tenant (BEFORE INSERT trigger)
CREATE OR REPLACE FUNCTION gen_venta_numero()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_venta_numero ON ventas;
CREATE TRIGGER set_venta_numero
  BEFORE INSERT ON ventas
  FOR EACH ROW
  EXECUTE FUNCTION gen_venta_numero();
