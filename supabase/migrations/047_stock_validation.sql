-- Migration 047: Bloqueo de stock negativo a nivel DB
-- Previene overselling incluso ante race conditions en el frontend.
--
-- Estrategia: CHECK constraint en inventario_lineas que impide
-- que cantidad < 0 o que la cantidad baje por debajo de cantidad_reservada.

-- 1. Impedir cantidad negativa en inventario_lineas
ALTER TABLE public.inventario_lineas
  ADD CONSTRAINT chk_cantidad_no_negativa
  CHECK (cantidad >= 0);

-- 2. Impedir que se rebaje por debajo de lo reservado
--    (cantidad no puede quedar menor que cantidad_reservada)
ALTER TABLE public.inventario_lineas
  ADD CONSTRAINT chk_cantidad_mayor_o_igual_reservada
  CHECK (cantidad >= cantidad_reservada);

-- 3. Impedir cantidad_reservada negativa
ALTER TABLE public.inventario_lineas
  ADD CONSTRAINT chk_cantidad_reservada_no_negativa
  CHECK (cantidad_reservada >= 0);

-- 4. Función auxiliar: devuelve el stock disponible real de un producto
--    para un tenant dado. Útil para validaciones en Edge Functions o scripts.
CREATE OR REPLACE FUNCTION public.stock_disponible_producto(
  p_producto_id UUID,
  p_tenant_id   UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(
    CASE
      -- Producto serializado: contar series activas y no reservadas
      WHEN EXISTS (
        SELECT 1 FROM inventario_series s
        WHERE s.linea_id = il.id AND s.activo = true
      )
      THEN (
        SELECT COUNT(*) FROM inventario_series s
        WHERE s.linea_id = il.id AND s.activo = true AND s.reservado = false
      )
      -- Producto no serializado: cantidad - reservada
      ELSE GREATEST(0, il.cantidad - COALESCE(il.cantidad_reservada, 0))
    END
  ), 0)
  FROM inventario_lineas il
  WHERE il.producto_id = p_producto_id
    AND il.tenant_id   = p_tenant_id
    AND il.activo      = true
    AND il.cantidad    > 0
    AND il.ubicacion_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.stock_disponible_producto IS
  'Retorna el stock disponible real (descontando reservas) de un producto para un tenant.';
