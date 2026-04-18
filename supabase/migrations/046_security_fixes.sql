-- Fix 1: Recrear stock_por_producto sin SECURITY DEFINER
-- La vista lee de productos e inventario_lineas que ya tienen RLS por tenant_id
DROP VIEW IF EXISTS public.stock_por_producto;

CREATE VIEW public.stock_por_producto AS
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

-- Fix 2: Habilitar RLS en aging_profile_reglas y agregar política tenant
ALTER TABLE public.aging_profile_reglas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'aging_profile_reglas'
    AND policyname = 'aging_profile_reglas_tenant'
  ) THEN
    CREATE POLICY "aging_profile_reglas_tenant"
    ON public.aging_profile_reglas
    FOR ALL
    TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
