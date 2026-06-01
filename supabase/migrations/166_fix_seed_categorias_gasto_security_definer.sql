-- Migration 166: fix RLS en el seed de categorias_gasto durante el onboarding
--
-- BUG: al registrar un negocio nuevo, el INSERT en tenants dispara el trigger
-- AFTER INSERT `trg_seed_categorias_gasto_new_tenant`, que seedea categorias_gasto
-- ANTES de que exista la fila en `users` que liga al usuario con el tenant
-- (el onboarding inserta users DESPUÉS del tenant). Como la función NO era
-- SECURITY DEFINER, el INSERT quedaba sujeto al RLS WITH CHECK
-- (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())) → conjunto
-- vacío → "new row violates row-level security policy for table categorias_gasto".
--
-- Las otras dos funciones de seed sobre tenants (fn_seed_tenant_defaults,
-- fn_crear_caja_fuerte) ya eran SECURITY DEFINER; ésta quedó sin serlo desde mig 130.
-- Fix: redefinir ambas funciones con SECURITY DEFINER + search_path fijo.

CREATE OR REPLACE FUNCTION seed_categorias_gasto(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO categorias_gasto (tenant_id, nombre, requiere_sucursal, predefinida, orden) VALUES
    (p_tenant_id, 'Alquiler',                       TRUE,  TRUE,  10),
    (p_tenant_id, 'Servicios (luz, gas, agua)',     TRUE,  TRUE,  20),
    (p_tenant_id, 'Internet y telefonía',           TRUE,  TRUE,  30),
    (p_tenant_id, 'Mercadería',                     TRUE,  TRUE,  40),
    (p_tenant_id, 'Insumos y suministros',          TRUE,  TRUE,  50),
    (p_tenant_id, 'Mantenimiento y reparaciones',   TRUE,  TRUE,  60),
    (p_tenant_id, 'Limpieza',                       TRUE,  TRUE,  70),
    (p_tenant_id, 'Marketing y publicidad',         FALSE, TRUE,  80),
    (p_tenant_id, 'Combustible',                    FALSE, TRUE,  90),
    (p_tenant_id, 'Transporte y fletes',            FALSE, TRUE, 100),
    (p_tenant_id, 'Impuestos y tasas',              FALSE, TRUE, 110),
    (p_tenant_id, 'Honorarios profesionales',       FALSE, TRUE, 120),
    (p_tenant_id, 'Comisiones bancarias',           FALSE, TRUE, 130),
    (p_tenant_id, 'SaaS y plataformas',             FALSE, TRUE, 140),
    (p_tenant_id, 'Capacitación',                   FALSE, TRUE, 150),
    (p_tenant_id, 'Otros',                          FALSE, TRUE, 999)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION fn_seed_categorias_gasto_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_categorias_gasto(NEW.id);
  RETURN NEW;
END;
$$;
