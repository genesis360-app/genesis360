-- Migration 082: corregir trigger stock — también dispara en UPDATE y DELETE
-- El trigger original solo disparaba en INSERT → stock_actual no se actualizaba
-- al eliminar LPN (activo=false), editar cantidad, o rebajes desde InventarioPage.

-- Actualizar la función para manejar DELETE correctamente
CREATE OR REPLACE FUNCTION public.trigger_recalcular_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalcular_stock(OLD.producto_id);
    RETURN OLD;
  ELSE
    PERFORM recalcular_stock(NEW.producto_id);
    -- Si el producto_id cambió (caso borde), recalcular el anterior también
    IF TG_OP = 'UPDATE' AND OLD.producto_id IS DISTINCT FROM NEW.producto_id THEN
      PERFORM recalcular_stock(OLD.producto_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

-- Reemplazar trigger de inventario_lineas para que dispare en INSERT, UPDATE y DELETE
DROP TRIGGER IF EXISTS lineas_recalcular_stock ON inventario_lineas;
CREATE TRIGGER lineas_recalcular_stock
  AFTER INSERT OR UPDATE OF cantidad, activo, producto_id OR DELETE
  ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();

-- También corregir trigger de inventario_series (mismo problema potencial)
DROP TRIGGER IF EXISTS series_recalcular_stock ON inventario_series;
CREATE TRIGGER series_recalcular_stock
  AFTER INSERT OR UPDATE OR DELETE
  ON inventario_series
  FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();
