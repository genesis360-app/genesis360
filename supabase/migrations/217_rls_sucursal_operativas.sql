-- Migration 217: RLS por sucursal — tanda 2 (resto de tablas operativas)
-- ============================================================
-- Continúa la mig 216. Mismo patrón y helpers (auth_ve_todas_sucursales /
-- auth_user_sucursal). Aplica el filtro de sucursal en lectura a las tablas
-- operativas restantes que YA filtran por sucursal del lado del cliente
-- (envíos, recepciones, OC, recursos, cajas, conteos) → server-side replica el
-- comportamiento existente, cierra la brecha de API directa, bajo riesgo.
--
-- Filas con sucursal_id IS NULL → visibles para todos (invariante: bóveda/Caja
-- Fuerte tiene sucursal_id NULL y es tenant-wide; legacy ya backfilleado).
-- WITH CHECK tenant-only: no rompe escrituras cross-sucursal legítimas (OC creada
-- por un usuario global, traslados, etc.).
--
-- NO se tocan (decisión 2026-06-16): catálogo/config (clientes, proveedores,
-- combos, credenciales de integración, ubicaciones, puntos_venta_afip,
-- producto_*_sucursal, courier_*, gastos_fijos), finanzas/tesorería (cheques),
-- workflow de aprobación (autorizaciones_gasto, devoluciones_proveedor),
-- dominio RRHH role-gated (rrhh_fichadas), sistema (integration_job_queue,
-- actividad_log) y logística centralizada (hojas_ruta, ventas_recurrentes).
--
-- Brecha residual conocida (tanda 3, requiere policies con JOIN al padre): las
-- tablas hijas SIN sucursal_id propia (caja_movimientos, venta_items,
-- venta_series, traslado_items, …) siguen tenant-only.
-- ============================================================

-- ENVIOS
DROP POLICY IF EXISTS "envios_tenant" ON envios;
CREATE POLICY "envios_tenant" ON envios FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- ORDENES DE COMPRA
DROP POLICY IF EXISTS "oc_tenant" ON ordenes_compra;
CREATE POLICY "oc_tenant" ON ordenes_compra FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- RECEPCIONES
DROP POLICY IF EXISTS "recepciones_tenant" ON recepciones;
CREATE POLICY "recepciones_tenant" ON recepciones FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- RECURSOS
DROP POLICY IF EXISTS "recursos_tenant" ON recursos;
CREATE POLICY "recursos_tenant" ON recursos FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- CAJAS (la Caja Fuerte/Bóveda tiene sucursal_id NULL → sigue visible para todos)
DROP POLICY IF EXISTS "cajas_tenant" ON cajas;
CREATE POLICY "cajas_tenant" ON cajas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- INVENTARIO CONTEOS
DROP POLICY IF EXISTS "conteos_tenant" ON inventario_conteos;
CREATE POLICY "conteos_tenant" ON inventario_conteos FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );
