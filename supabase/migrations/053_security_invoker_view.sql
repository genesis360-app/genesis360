-- Migration 053: Agregar security_invoker=true a stock_por_producto
-- Supabase Security Advisor recomienda que las vistas usen los permisos
-- del usuario que consulta (security_invoker) en vez del owner (defecto).
-- Las tablas subyacentes ya tienen RLS por tenant_id.

CREATE OR REPLACE VIEW public.stock_por_producto
WITH (security_invoker = true)
AS
SELECT
  p.id        AS producto_id,
  p.tenant_id,
  p.nombre,
  p.sku,
  COALESCE(SUM(l.cantidad), 0::bigint) AS stock_total,
  COUNT(DISTINCT l.id)                 AS nro_lineas
FROM productos p
LEFT JOIN inventario_lineas l
  ON l.producto_id = p.id AND l.activo = true
WHERE p.activo = true
GROUP BY p.id, p.tenant_id, p.nombre, p.sku;

GRANT SELECT ON public.stock_por_producto TO authenticated;
