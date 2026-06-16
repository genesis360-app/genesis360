-- Migration 218: RLS por sucursal — tanda 3 (tablas hijas sin sucursal_id propia)
-- ============================================================
-- Cierra la brecha que dejaban las migs 216/217: las tablas hijas que NO tienen
-- sucursal_id propia heredan la visibilidad de su padre (ya scopeado) vía un
-- EXISTS de un solo salto. Sin esto, un usuario restringido podía leer por API
-- directa el detalle (renglones de venta, movimientos de caja, etc.) de ventas
-- de otra sucursal aunque la cabecera estuviera protegida.
--
-- Patrón: tenant (se mantiene) AND ( ve_todas OR fk IS NULL OR padre_visible ).
--   * fk IS NULL → fila huérfana/global → visible para todos (invariante NULL).
--   * padre_visible = EXISTS fila padre con sucursal_id NULL o = la del usuario.
-- No depende de RLS anidada: el predicado de sucursal del padre va explícito.
-- WITH CHECK queda tenant-only (no romper inserts/triggers cross-sucursal).
--
-- Helpers de mig 216 (auth_ve_todas_sucursales / auth_user_sucursal).
--
-- SE DEJAN tenant-only a propósito (consistente con 216/217): finanzas/tesorería
-- (cheques, proveedor_cc_movimientos, autorizaciones_cc, devoluciones_proveedor,
-- courier_factura_lineas), cliente_creditos (cliente es global), ventas_externas_logs
-- (logs de integración), sub-detalle de logística (envio_otp/pod_fotos/incidencias/
-- hoja_ruta_envios), y las que cruzan sucursales por diseño (caja_traspasos con
-- doble sesión, traslado_items con línea origen+destino). devolucion_items queda
-- pendiente (2 saltos).
-- ============================================================

-- ── Hijas de VENTAS (fk = venta_id) ─────────────────────────
DROP POLICY IF EXISTS "venta_items_tenant" ON venta_items;
CREATE POLICY "venta_items_tenant" ON venta_items FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_items.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

DROP POLICY IF EXISTS "venta_series_tenant" ON venta_series;
CREATE POLICY "venta_series_tenant" ON venta_series FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_series.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

DROP POLICY IF EXISTS "venta_item_despachos_tenant" ON venta_item_despachos;
CREATE POLICY "venta_item_despachos_tenant" ON venta_item_despachos FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_item_despachos.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

DROP POLICY IF EXISTS "venta_auditoria_tenant" ON venta_auditoria;
CREATE POLICY "venta_auditoria_tenant" ON venta_auditoria FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_auditoria.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- devoluciones: solo SELECT (el INSERT dev_tenant_insert queda tenant-only)
DROP POLICY IF EXISTS "dev_tenant_select" ON devoluciones;
CREATE POLICY "dev_tenant_select" ON devoluciones FOR SELECT
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = devoluciones.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) );

-- ── Hijas de CAJA_SESIONES (fk = sesion_id) ─────────────────
DROP POLICY IF EXISTS "mov_caja_tenant" ON caja_movimientos;
CREATE POLICY "mov_caja_tenant" ON caja_movimientos FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sesion_id IS NULL
          OR EXISTS (SELECT 1 FROM caja_sesiones s WHERE s.id = caja_movimientos.sesion_id
                     AND ( s.sucursal_id IS NULL OR s.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

DROP POLICY IF EXISTS "tenant_caja_arqueos" ON caja_arqueos;
CREATE POLICY "tenant_caja_arqueos" ON caja_arqueos FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sesion_id IS NULL
          OR EXISTS (SELECT 1 FROM caja_sesiones s WHERE s.id = caja_arqueos.sesion_id
                     AND ( s.sucursal_id IS NULL OR s.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- ── Hijas SIN tenant_id propia: scopean 100% vía el padre (que lleva tenant + sucursal) ──
-- ORDENES_COMPRA (fk = orden_compra_id)
DROP POLICY IF EXISTS "oc_items_tenant" ON orden_compra_items;
CREATE POLICY "oc_items_tenant" ON orden_compra_items FOR ALL
  USING ( orden_compra_id IN (
            SELECT o.id FROM ordenes_compra o
            WHERE o.tenant_id = get_user_tenant_id()
              AND ( auth_ve_todas_sucursales() OR o.sucursal_id IS NULL OR o.sucursal_id = auth_user_sucursal() ) ) )
  WITH CHECK ( orden_compra_id IN ( SELECT o.id FROM ordenes_compra o WHERE o.tenant_id = get_user_tenant_id() ) );

-- RECEPCIONES (fk = recepcion_id)
DROP POLICY IF EXISTS "recepcion_items_tenant" ON recepcion_items;
CREATE POLICY "recepcion_items_tenant" ON recepcion_items FOR ALL
  USING ( recepcion_id IN (
            SELECT r.id FROM recepciones r
            WHERE r.tenant_id = get_user_tenant_id()
              AND ( auth_ve_todas_sucursales() OR r.sucursal_id IS NULL OR r.sucursal_id = auth_user_sucursal() ) ) )
  WITH CHECK ( recepcion_id IN ( SELECT r.id FROM recepciones r WHERE r.tenant_id = get_user_tenant_id() ) );

-- INVENTARIO_CONTEOS (fk = conteo_id)
DROP POLICY IF EXISTS "conteo_items_tenant" ON inventario_conteo_items;
CREATE POLICY "conteo_items_tenant" ON inventario_conteo_items FOR ALL
  USING ( conteo_id IN (
            SELECT c.id FROM inventario_conteos c
            WHERE c.tenant_id = get_user_tenant_id()
              AND ( auth_ve_todas_sucursales() OR c.sucursal_id IS NULL OR c.sucursal_id = auth_user_sucursal() ) ) )
  WITH CHECK ( conteo_id IN ( SELECT c.id FROM inventario_conteos c WHERE c.tenant_id = get_user_tenant_id() ) );

-- ── Hija de ENVIOS (fk = envio_id) ──────────────────────────
DROP POLICY IF EXISTS "envio_items_tenant" ON envio_items;
CREATE POLICY "envio_items_tenant" ON envio_items FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR envio_id IS NULL
          OR EXISTS (SELECT 1 FROM envios e WHERE e.id = envio_items.envio_id
                     AND ( e.sucursal_id IS NULL OR e.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- ── Hija de INVENTARIO_LINEAS (fk = linea_id) — detalle de series ──
DROP POLICY IF EXISTS "series_tenant" ON inventario_series;
CREATE POLICY "series_tenant" ON inventario_series FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR linea_id IS NULL
          OR EXISTS (SELECT 1 FROM inventario_lineas l WHERE l.id = inventario_series.linea_id
                     AND ( l.sucursal_id IS NULL OR l.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );
