-- Migration 216: RLS por sucursal — tanda 1 (core operativo)
-- ============================================================
-- Cierra la brecha histórica: hasta ahora la RLS filtraba SOLO por tenant_id y
-- el aislamiento por sucursal era client-side (triple blindaje en authStore).
-- Un usuario con credenciales podía leer otra sucursal del mismo tenant vía API
-- directa. Esta migración mueve ese aislamiento al servidor para las 5 tablas
-- operativas más sensibles.
--
-- Decisiones (confirmadas con GO, 2026-06-16):
--   * Filas con sucursal_id IS NULL → visibles para todos (invariante histórica:
--     bóveda/Caja Fuerte es tenant-wide, y los NULL operativos ya fueron
--     backfilleados en migs 114-117).
--   * Tanda 1 = ventas, caja_sesiones, gastos, inventario_lineas, movimientos_stock.
--   * Tablas GLOBALES por diseño NO se tocan: productos, categorias, proveedores
--     y clientes (clientes tiene sucursal_id pero es trazabilidad de origen, no scope).
--   * El aislamiento se aplica en lectura (USING). El WITH CHECK queda tenant-only
--     para no romper escrituras cross-sucursal legítimas (traslados escriben
--     movimientos/lineas en AMBAS sucursales; triggers generan filas).
--
-- Helpers nuevos replican EXACTAMENTE authStore.ts (líneas 92-95) para no
-- desincronizarse: un DUEÑO/SUPERVISOR/VIEWER global en la UI debe serlo en la DB
-- o quedaría viendo NADA (su sucursal_id puede ser NULL).
-- ============================================================

-- ── 1) Helpers ──────────────────────────────────────────────
-- ¿El usuario actual ve todas las sucursales? (espejo de authStore.puedeVerTodas)
CREATE OR REPLACE FUNCTION public.auth_ve_todas_sucursales()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
      AND (
        u.rol = 'DUEÑO'                                                            -- siempre global
        OR (u.rol IN ('SUPERVISOR','SUPER_USUARIO','VIEWER') AND u.puede_ver_todas IS NOT FALSE)  -- global por defecto
        OR u.puede_ver_todas = TRUE                                                -- resto: solo si explícito
      )
  )
$$;

-- Sucursal asignada al usuario actual (NULL para roles globales)
CREATE OR REPLACE FUNCTION public.auth_user_sucursal()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sucursal_id FROM users WHERE id = auth.uid()
$$;

-- ── 2) Policies por sucursal (lectura) ──────────────────────
-- Patrón: tenant_id (se mantiene) AND ( ve_todas OR fila NULL OR fila = su sucursal )

-- VENTAS
DROP POLICY IF EXISTS "ventas_tenant" ON ventas;
CREATE POLICY "ventas_tenant" ON ventas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- CAJA SESIONES (las de bóveda/Caja Fuerte tienen sucursal_id NULL → siguen visibles)
DROP POLICY IF EXISTS "sesiones_tenant" ON caja_sesiones;
CREATE POLICY "sesiones_tenant" ON caja_sesiones FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- GASTOS
DROP POLICY IF EXISTS "gastos_tenant" ON gastos;
CREATE POLICY "gastos_tenant" ON gastos FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- INVENTARIO LINEAS
DROP POLICY IF EXISTS "lineas_tenant" ON inventario_lineas;
CREATE POLICY "lineas_tenant" ON inventario_lineas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- MOVIMIENTOS STOCK (append-only: solo SELECT recibe el filtro; INSERT queda
-- tenant-only para no romper traslados/triggers que escriben en otra sucursal;
-- no hay policy UPDATE/DELETE → siguen denegados por diseño)
DROP POLICY IF EXISTS "movimientos_select" ON movimientos_stock;
CREATE POLICY "movimientos_select" ON movimientos_stock FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  );
-- "movimientos_insert" (tenant-only WITH CHECK) se deja sin cambios.
