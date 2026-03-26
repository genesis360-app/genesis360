-- ============================================================
-- Stokio — Schema completo (actualizado 2026-03-26, migrations 001–024)
-- Aplicar en Supabase DEV con el SQL Editor
-- ============================================================

-- ============================================================
-- FUNCIONES: no dependen de tablas del usuario
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_lpn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lpn IS NULL OR NEW.lpn = '' THEN
    NEW.lpn := 'LPN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 1. PLANES
-- ============================================================
CREATE TABLE planes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  max_users     INT NOT NULL DEFAULT 2,
  precio_mensual DECIMAL(10,2) NOT NULL,
  mp_plan_id    TEXT,
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO planes (nombre, max_users, precio_mensual, activo) VALUES
  ('Free',       1,     0.00, TRUE),
  ('Básico',     2,  4900.00, TRUE),
  ('Pro',       10,  9900.00, TRUE),
  ('Enterprise', 999, 0.00,  TRUE);

-- ============================================================
-- 2. TENANTS
-- ============================================================
CREATE TABLE tenants (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                    TEXT NOT NULL,
  tipo_comercio             TEXT,
  pais                      TEXT DEFAULT 'AR',
  subscription_status       TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial','active','inactive','cancelled')),
  trial_ends_at             TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  plan_id                   UUID REFERENCES planes(id),
  max_users                 INT NOT NULL DEFAULT 2,
  max_productos             INT NOT NULL DEFAULT 50,
  mp_subscription_id        TEXT,
  logo_url                  TEXT,
  cotizacion_usd            DECIMAL(14,2),
  cotizacion_usd_updated_at TIMESTAMPTZ,
  regla_inventario          TEXT NOT NULL DEFAULT 'FIFO',
  created_at                TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. USERS
-- ============================================================
CREATE TABLE users (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,
  rol            TEXT NOT NULL DEFAULT 'CAJERO'
    CHECK (rol IN ('OWNER','SUPERVISOR','CAJERO','ADMIN')),
  nombre_display TEXT,
  activo         BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FUNCIONES HELPER (después de crear users)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT rol FROM users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND rol = 'ADMIN'
  )
$$;

-- ============================================================
-- 4. CATEGORÍAS
-- ============================================================
CREATE TABLE categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. PROVEEDORES
-- ============================================================
CREATE TABLE proveedores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  contacto    TEXT,
  telefono    TEXT,
  email       TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. UBICACIONES
-- ============================================================
CREATE TABLE ubicaciones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  descripcion         TEXT,
  prioridad           INT NOT NULL DEFAULT 0,
  disponible_surtido  BOOLEAN NOT NULL DEFAULT TRUE,
  activo              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. ESTADOS DE INVENTARIO
-- ============================================================
CREATE TABLE estados_inventario (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE estados_inventario ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. GRUPOS DE ESTADOS
-- ============================================================
CREATE TABLE grupos_estados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  es_default  BOOLEAN DEFAULT FALSE,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE grupos_estados ENABLE ROW LEVEL SECURITY;

CREATE TABLE grupo_estado_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id  UUID NOT NULL REFERENCES grupos_estados(id) ON DELETE CASCADE,
  estado_id UUID NOT NULL REFERENCES estados_inventario(id) ON DELETE CASCADE,
  UNIQUE(grupo_id, estado_id)
);
ALTER TABLE grupo_estado_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. MOTIVOS DE MOVIMIENTO
-- ============================================================
CREATE TABLE motivos_movimiento (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'ambos',
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE motivos_movimiento ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 10. PRODUCTOS
-- ============================================================
CREATE TABLE productos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  sku              TEXT NOT NULL,
  descripcion      TEXT,
  categoria_id     UUID REFERENCES categorias(id),
  proveedor_id     UUID REFERENCES proveedores(id),
  ubicacion_id     UUID REFERENCES ubicaciones(id),
  estado_id        UUID REFERENCES estados_inventario(id),
  precio_costo     DECIMAL(12,2) DEFAULT 0,
  precio_venta     DECIMAL(12,2) DEFAULT 0,
  margen_ganancia  DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN precio_costo > 0
      THEN ROUND(((precio_venta - precio_costo) / precio_costo) * 100, 2)
      ELSE 0
    END
  ) STORED,
  stock_actual     INT NOT NULL DEFAULT 0,
  stock_minimo     INT NOT NULL DEFAULT 0,
  unidad_medida    TEXT DEFAULT 'unidad',
  codigo_barras    TEXT,
  imagen_url       TEXT,
  tiene_series      BOOLEAN DEFAULT FALSE,
  tiene_lote        BOOLEAN DEFAULT FALSE,
  tiene_vencimiento BOOLEAN DEFAULT FALSE,
  regla_inventario  TEXT,
  aging_profile_id  UUID,  -- FK → aging_profiles (se agrega FK después de crear la tabla)
  margen_objetivo   DECIMAL(5,2),
  activo            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_productos_tenant   ON productos(tenant_id);
CREATE INDEX idx_productos_sku      ON productos(tenant_id, sku);
CREATE INDEX idx_productos_categoria ON productos(categoria_id);

-- ============================================================
-- FUNCIÓN check_stock_minimo (después de productos y alertas)
-- se crea después de la tabla alertas más abajo
-- ============================================================

-- ============================================================
-- 11. INVENTARIO LINEAS (LPN)
-- ============================================================
CREATE TABLE inventario_lineas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL REFERENCES productos(id),
  lpn                TEXT NOT NULL,
  cantidad           INT NOT NULL DEFAULT 0,
  cantidad_reservada INT NOT NULL DEFAULT 0,
  estado_id          UUID REFERENCES estados_inventario(id),
  ubicacion_id       UUID REFERENCES ubicaciones(id),
  proveedor_id       UUID REFERENCES proveedores(id),
  nro_lote           TEXT,
  fecha_vencimiento  DATE,
  precio_costo_snapshot DECIMAL(14,2),
  activo             BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE inventario_lineas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_lineas_tenant    ON inventario_lineas(tenant_id);
CREATE INDEX idx_lineas_producto   ON inventario_lineas(producto_id);
CREATE INDEX idx_ubicaciones_prioridad ON ubicaciones(tenant_id, prioridad);

-- ============================================================
-- 12. INVENTARIO SERIES
-- ============================================================
CREATE TABLE inventario_series (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  linea_id    UUID NOT NULL REFERENCES inventario_lineas(id),
  nro_serie   TEXT NOT NULL,
  estado_id   UUID REFERENCES estados_inventario(id),
  reservado   BOOLEAN DEFAULT FALSE,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, producto_id, nro_serie)
);
ALTER TABLE inventario_series ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_series_producto ON inventario_series(producto_id);
CREATE INDEX idx_series_linea    ON inventario_series(linea_id);

-- ============================================================
-- 13. MOVIMIENTOS DE STOCK
-- ============================================================
CREATE TABLE movimientos_stock (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id  UUID NOT NULL REFERENCES productos(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('ingreso','rebaje','ajuste')),
  cantidad     INT NOT NULL CHECK (cantidad > 0),
  stock_antes  INT NOT NULL,
  stock_despues INT NOT NULL,
  motivo       TEXT,
  estado_id    UUID REFERENCES estados_inventario(id),
  proveedor_id UUID REFERENCES proveedores(id),
  usuario_id   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE movimientos_stock ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_movimientos_tenant  ON movimientos_stock(tenant_id);
CREATE INDEX idx_movimientos_producto ON movimientos_stock(producto_id);
CREATE INDEX idx_movimientos_fecha   ON movimientos_stock(created_at);

-- ============================================================
-- 14. ALERTAS
-- ============================================================
CREATE TABLE alertas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  tipo        TEXT NOT NULL DEFAULT 'stock_minimo',
  mensaje     TEXT,
  resuelta    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_alertas_tenant ON alertas(tenant_id, resuelta);

-- ============================================================
-- FUNCIONES que dependen de productos y alertas
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_stock_minimo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock_actual <= NEW.stock_minimo THEN
    INSERT INTO alertas (tenant_id, producto_id, tipo, mensaje)
    VALUES (
      NEW.tenant_id, NEW.id, 'stock_minimo',
      'Stock de ' || NEW.nombre || ' llegó al mínimo (' || NEW.stock_actual || ' unidades)'
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalcular_stock(p_producto_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tiene_series BOOLEAN;
  v_stock INT;
BEGIN
  SELECT tiene_series INTO v_tiene_series FROM productos WHERE id = p_producto_id;
  IF v_tiene_series THEN
    SELECT COUNT(*) INTO v_stock FROM inventario_series
    WHERE producto_id = p_producto_id AND activo = TRUE;
  ELSE
    SELECT COALESCE(SUM(cantidad), 0) INTO v_stock FROM inventario_lineas
    WHERE producto_id = p_producto_id AND activo = TRUE;
  END IF;
  UPDATE productos SET stock_actual = v_stock WHERE id = p_producto_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_recalcular_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalcular_stock(OLD.producto_id);
  ELSE
    PERFORM recalcular_stock(NEW.producto_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER productos_updated_at
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER productos_stock_check
  AFTER UPDATE OF stock_actual ON productos
  FOR EACH ROW EXECUTE FUNCTION check_stock_minimo();

CREATE TRIGGER lineas_lpn_trigger
  BEFORE INSERT ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION generate_lpn();

CREATE TRIGGER lineas_updated_at
  BEFORE UPDATE ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER lineas_recalcular_stock
  AFTER INSERT ON inventario_lineas
  FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();

CREATE TRIGGER series_recalcular_stock
  AFTER INSERT ON inventario_series
  FOR EACH ROW EXECUTE FUNCTION trigger_recalcular_stock();

-- ============================================================
-- 15. CLIENTES (M8)
-- ============================================================
CREATE TABLE clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  telefono    TEXT,
  email       TEXT,
  notas       TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 16. VENTAS
-- ============================================================
CREATE TABLE ventas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero          INT NOT NULL,
  cliente_id      UUID REFERENCES clientes(id),
  cliente_nombre  TEXT,
  cliente_telefono TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente',
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  medio_pago      TEXT,
  notas           TEXT,
  usuario_id      UUID REFERENCES users(id),
  despachado_at   TIMESTAMPTZ,
  cancelado_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ventas_tenant ON ventas(tenant_id);
CREATE INDEX idx_ventas_estado ON ventas(tenant_id, estado);

CREATE TRIGGER ventas_updated_at
  BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: auto-generar numero de venta por tenant
CREATE OR REPLACE FUNCTION gen_venta_numero()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas WHERE tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_venta_numero ON ventas;
CREATE TRIGGER set_venta_numero
  BEFORE INSERT ON ventas
  FOR EACH ROW EXECUTE FUNCTION gen_venta_numero();

-- ============================================================
-- 17. VENTA ITEMS
-- ============================================================
CREATE TABLE venta_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id               UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id            UUID NOT NULL REFERENCES productos(id),
  linea_id               UUID REFERENCES inventario_lineas(id),
  cantidad               INT NOT NULL DEFAULT 1,
  precio_unitario        DECIMAL(12,2) NOT NULL,
  descuento              DECIMAL(5,2) NOT NULL DEFAULT 0,
  subtotal               DECIMAL(12,2) NOT NULL,
  precio_costo_historico DECIMAL(14,2),
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE venta_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_venta_items_venta ON venta_items(venta_id);

-- ============================================================
-- 18. VENTA SERIES
-- ============================================================
CREATE TABLE venta_series (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id      UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  venta_item_id UUID NOT NULL REFERENCES venta_items(id) ON DELETE CASCADE,
  serie_id      UUID NOT NULL REFERENCES inventario_series(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE venta_series ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_venta_series_venta ON venta_series(venta_id);

-- ============================================================
-- 19. CAJAS
-- ============================================================
CREATE TABLE cajas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_cajas_tenant ON cajas(tenant_id);

-- ============================================================
-- 20. CAJA SESIONES
-- ============================================================
CREATE TABLE caja_sesiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caja_id        UUID NOT NULL REFERENCES cajas(id),
  usuario_id     UUID REFERENCES users(id),
  monto_apertura DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_cierre   DECIMAL(12,2),
  total_ingresos DECIMAL(12,2) DEFAULT 0,
  total_egresos  DECIMAL(12,2) DEFAULT 0,
  total_ventas       DECIMAL(12,2) DEFAULT 0,
  estado             TEXT NOT NULL DEFAULT 'abierta',
  notas_cierre       TEXT,
  monto_real_cierre  DECIMAL(12,2),
  diferencia_cierre  DECIMAL(12,2),
  cerrado_por_id     UUID REFERENCES users(id),
  abierta_at         TIMESTAMPTZ DEFAULT NOW(),
  cerrada_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE caja_sesiones ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_sesiones_tenant ON caja_sesiones(tenant_id, estado);
CREATE INDEX idx_sesiones_caja   ON caja_sesiones(caja_id);

-- ============================================================
-- 21. CAJA MOVIMIENTOS
-- ============================================================
CREATE TABLE caja_movimientos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id   UUID NOT NULL REFERENCES caja_sesiones(id),
  tipo        TEXT NOT NULL,
  concepto    TEXT NOT NULL,
  monto       DECIMAL(12,2) NOT NULL,
  usuario_id  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE caja_movimientos ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mov_caja_sesion ON caja_movimientos(sesion_id);

-- ============================================================
-- 22. VISTA
-- ============================================================
CREATE OR REPLACE VIEW stock_por_producto AS
  SELECT p.id AS producto_id, p.tenant_id, p.nombre, p.sku,
    COALESCE(SUM(l.cantidad), 0) AS stock_total,
    COUNT(DISTINCT l.id) AS nro_lineas
  FROM productos p
  LEFT JOIN inventario_lineas l ON l.producto_id = p.id AND l.activo = TRUE
  WHERE p.activo = TRUE
  GROUP BY p.id, p.tenant_id, p.nombre, p.sku;

-- ============================================================
-- 23. RLS POLICIES
-- ============================================================

-- TENANTS
CREATE POLICY "tenants_select" ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) OR is_admin());
CREATE POLICY "tenants_insert_new_user" ON tenants FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tenants_update" ON tenants FOR UPDATE
  USING (
    (id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) AND
     EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND rol IN ('OWNER','ADMIN')))
    OR is_admin()
  );

-- USERS
CREATE POLICY "users_select" ON users FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_admin());
CREATE POLICY "users_insert_self" ON users FOR INSERT
  WITH CHECK (id = auth.uid());
CREATE POLICY "users_insert_owner" ON users FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','ADMIN'));
CREATE POLICY "users_update_owner" ON users FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','ADMIN'));

-- CATEGORÍAS
CREATE POLICY "categorias_tenant" ON categorias FOR ALL
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "categorias_insert" ON categorias FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- PROVEEDORES
CREATE POLICY "proveedores_tenant" ON proveedores FOR ALL
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "proveedores_insert" ON proveedores FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- UBICACIONES
CREATE POLICY "ubicaciones_tenant" ON ubicaciones FOR ALL
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ubicaciones_insert" ON ubicaciones FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ESTADOS INVENTARIO
CREATE POLICY "estados_tenant" ON estados_inventario FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- GRUPOS ESTADOS
CREATE POLICY "grupos_tenant" ON grupos_estados FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- GRUPO ESTADO ITEMS
CREATE POLICY "grupo_items_tenant" ON grupo_estado_items FOR ALL
  USING (grupo_id IN (
    SELECT id FROM grupos_estados WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  ));

-- MOTIVOS MOVIMIENTO
CREATE POLICY "motivos_tenant" ON motivos_movimiento FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- PRODUCTOS
CREATE POLICY "productos_select" ON productos FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()) OR is_admin());
CREATE POLICY "productos_insert_tenant" ON productos FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY "productos_update_tenant" ON productos FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY "productos_delete_tenant" ON productos FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- INVENTARIO LINEAS
CREATE POLICY "lineas_tenant" ON inventario_lineas FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- INVENTARIO SERIES
CREATE POLICY "series_tenant" ON inventario_series FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- MOVIMIENTOS STOCK
CREATE POLICY "movimientos_select" ON movimientos_stock FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "movimientos_insert" ON movimientos_stock FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ALERTAS
CREATE POLICY "alertas_tenant" ON alertas FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- CLIENTES
CREATE POLICY "clientes_tenant" ON clientes FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- VENTAS
CREATE POLICY "ventas_tenant" ON ventas FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- VENTA ITEMS
CREATE POLICY "venta_items_tenant" ON venta_items FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- VENTA SERIES
CREATE POLICY "venta_series_tenant" ON venta_series FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- CAJAS
CREATE POLICY "cajas_tenant" ON cajas FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- CAJA SESIONES
CREATE POLICY "sesiones_tenant" ON caja_sesiones FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- CAJA MOVIMIENTOS
CREATE POLICY "mov_caja_tenant" ON caja_movimientos FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================================
-- M14. COMBOS (reglas de precio por volumen)
-- ============================================================
CREATE TABLE IF NOT EXISTS combos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad      INT NOT NULL DEFAULT 2 CHECK (cantidad >= 2),
  descuento_pct   DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  descuento_tipo  TEXT NOT NULL DEFAULT 'pct',
  descuento_monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE combos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON combos;
CREATE POLICY "tenant_isolation" ON combos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================================
-- M15. GASTOS (egresos del negocio)
-- ============================================================
CREATE TABLE IF NOT EXISTS gastos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  monto       NUMERIC(12,2) NOT NULL,
  categoria   TEXT,
  medio_pago  TEXT,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id  UUID REFERENCES users(id),
  notas       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gastos_tenant" ON gastos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ============================================================
-- M16. STORAGE — bucket 'productos' (imágenes de productos)
-- ============================================================
-- NOTA: El bucket debe crearse manualmente via API o dashboard de Supabase.
-- No se puede crear con SQL. Comando para crear:
--   curl -X POST "https://{PROJECT_REF}.supabase.co/storage/v1/bucket" \
--     -H "Authorization: Bearer {SERVICE_ROLE_KEY}" \
--     -H "Content-Type: application/json" \
--     -d '{"id": "productos", "name": "productos", "public": true}'
--
-- Políticas RLS del bucket (sí se aplican con SQL):
DO $$ BEGIN
  CREATE POLICY read_productos ON storage.objects
    FOR SELECT USING (bucket_id = 'productos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY upload_productos ON storage.objects
    FOR INSERT WITH CHECK ((bucket_id = 'productos') AND (auth.uid() IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY update_productos ON storage.objects
    FOR UPDATE USING ((bucket_id = 'productos') AND (auth.uid() IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY delete_productos ON storage.objects
    FOR DELETE USING ((bucket_id = 'productos') AND (auth.uid() IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- M17. ACTIVIDAD LOG (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS actividad_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES users(id),
  usuario_nombre  TEXT,
  entidad         TEXT NOT NULL,
  entidad_id      TEXT,
  entidad_nombre  TEXT,
  accion          TEXT NOT NULL,
  campo           TEXT,
  valor_anterior  TEXT,
  valor_nuevo     TEXT,
  pagina          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS actividad_log_tenant_idx  ON actividad_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS actividad_log_entidad_idx ON actividad_log (tenant_id, entidad);
CREATE INDEX IF NOT EXISTS actividad_log_usuario_idx ON actividad_log (tenant_id, usuario_id);
ALTER TABLE actividad_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actividad_log_insert" ON actividad_log
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY "actividad_log_select" ON actividad_log
  FOR SELECT USING (
    is_admin()
    OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND rol IN ('OWNER', 'SUPERVISOR'))
  );

-- ============================================================
-- M18. AGING PROFILES (cambio automático de estado por vencimiento)
-- ============================================================
CREATE TABLE IF NOT EXISTS aging_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aging_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aging_profiles_tenant" ON aging_profiles
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS aging_profile_reglas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES aging_profiles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estado_id   UUID NOT NULL REFERENCES estados_inventario(id) ON DELETE RESTRICT,
  dias        INT NOT NULL CHECK (dias >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aging_profile_reglas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aging_profile_reglas_tenant" ON aging_profile_reglas
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- FK de productos → aging_profiles (circular, se agrega después)
ALTER TABLE productos ADD CONSTRAINT IF NOT EXISTS fk_productos_aging_profile
  FOREIGN KEY (aging_profile_id) REFERENCES aging_profiles(id) ON DELETE SET NULL;

-- Función de procesamiento de aging (ver migration 013 para documentación completa)
CREATE OR REPLACE FUNCTION process_aging_profiles(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_tenant UUID; v_linea RECORD; v_estado_nuevo UUID;
  v_estado_ant TEXT; v_estado_nuevo_nombre TEXT; v_cambios INT := 0; v_dias INT;
BEGIN
  IF p_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  ELSE v_target_tenant := p_tenant_id; END IF;
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0); END IF;
  FOR v_linea IN
    SELECT il.id, il.estado_id, il.fecha_vencimiento, il.tenant_id, il.producto_id,
           p.aging_profile_id, p.nombre AS prod_nombre
    FROM inventario_lineas il JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id IS NOT NULL AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;
    SELECT apr.estado_id INTO v_estado_nuevo FROM aging_profile_reglas apr
    WHERE apr.profile_id = v_linea.aging_profile_id AND apr.dias >= v_dias
    ORDER BY apr.dias ASC LIMIT 1;
    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nombre FROM estados_inventario WHERE id = v_estado_nuevo;
      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;
      INSERT INTO actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id,
        entidad_nombre, accion, campo, valor_anterior, valor_nuevo, pagina)
      VALUES (v_linea.tenant_id, NULL, 'Sistema (Aging)', 'inventario_linea', v_linea.id::TEXT,
        v_linea.prod_nombre, 'cambio_estado_auto', 'estado',
        COALESCE(v_estado_ant, 'Sin estado'), COALESCE(v_estado_nuevo_nombre, 'Sin estado'), '/aging-auto');
      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('cambios', v_cambios, 'tenant_id', v_target_tenant, 'procesado_en', NOW());
END;
$$;

-- ============================================================
-- M18. RRHH — EMPLEADOS (Phase 1)
-- ============================================================

-- Helper function para validar que usuario es RRHH o OWNER
CREATE OR REPLACE FUNCTION public.is_rrhh()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND (rol = 'RRHH' OR rol = 'OWNER')
  )
$$;

-- DEPARTAMENTOS
CREATE TABLE IF NOT EXISTS rrhh_departamentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_departamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_departamentos_tenant" ON rrhh_departamentos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_rrhh_departamentos_tenant ON rrhh_departamentos(tenant_id);
CREATE INDEX idx_rrhh_departamentos_activo ON rrhh_departamentos(activo);

-- PUESTOS
CREATE TABLE IF NOT EXISTS rrhh_puestos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  salario_base_sugerido NUMERIC(12, 2),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_puestos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_puestos_tenant" ON rrhh_puestos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_rrhh_puestos_tenant ON rrhh_puestos(tenant_id);
CREATE INDEX idx_rrhh_puestos_activo ON rrhh_puestos(activo);

-- EMPLEADOS
CREATE TABLE IF NOT EXISTS empleados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL DEFAULT '',
  apellido        TEXT,
  dni_rut         TEXT NOT NULL,
  tipo_doc        TEXT CHECK (tipo_doc IN ('DNI', 'RUT', 'PASAPORTE', 'OTRO')) DEFAULT 'DNI',
  tel_personal    TEXT,
  email_personal  TEXT,
  genero          TEXT CHECK (genero IN ('M', 'F', 'OTRO')) DEFAULT 'OTRO',
  direccion       TEXT,
  fon             TEXT,
  fecha_nacimiento DATE,
  fecha_ingreso   DATE NOT NULL,
  fecha_egreso    DATE,
  puesto_id       UUID REFERENCES rrhh_puestos(id) ON DELETE SET NULL,
  departamento_id UUID REFERENCES rrhh_departamentos(id) ON DELETE SET NULL,
  supervisor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  tipo_contrato   TEXT CHECK (tipo_contrato IN ('INDEFINIDO', 'PLAZO_FIJO', 'FREELANCE', 'TEMPORAL')) DEFAULT 'INDEFINIDO',
  salario_bruto   NUMERIC(12, 2),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, dni_rut)
);

ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empleados_tenant" ON empleados
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_empleados_tenant ON empleados(tenant_id);
CREATE INDEX idx_empleados_activo ON empleados(activo);
CREATE INDEX idx_empleados_fecha_nacimiento ON empleados(fecha_nacimiento);
CREATE INDEX idx_empleados_puesto ON empleados(puesto_id);
CREATE INDEX idx_empleados_departamento ON empleados(departamento_id);

-- Triggers para timestamps
CREATE OR REPLACE FUNCTION update_empleados_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER empleados_update_timestamp
BEFORE UPDATE ON empleados
FOR EACH ROW
EXECUTE FUNCTION update_empleados_timestamp();

CREATE OR REPLACE FUNCTION update_rrhh_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rrhh_puestos_update_timestamp
BEFORE UPDATE ON rrhh_puestos
FOR EACH ROW
EXECUTE FUNCTION update_rrhh_timestamp();

CREATE TRIGGER rrhh_departamentos_update_timestamp
BEFORE UPDATE ON rrhh_departamentos
FOR EACH ROW
EXECUTE FUNCTION update_rrhh_timestamp();

-- ============================================================
-- Migration 017: RRHH Phase 2A — Nómina
-- ============================================================

CREATE TABLE IF NOT EXISTS rrhh_conceptos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('HABER', 'DESCUENTO')),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_conceptos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_conceptos_tenant ON rrhh_conceptos(tenant_id);
CREATE POLICY "rrhh_conceptos_tenant" ON rrhh_conceptos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS rrhh_salarios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id        UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  periodo            DATE NOT NULL,
  basico             DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_haberes      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_descuentos   DECIMAL(12,2) NOT NULL DEFAULT 0,
  neto               DECIMAL(12,2) NOT NULL DEFAULT 0,
  pagado             BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago         TIMESTAMPTZ,
  caja_movimiento_id UUID REFERENCES caja_movimientos(id),
  notas              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, empleado_id, periodo)
);
ALTER TABLE rrhh_salarios ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_tenant   ON rrhh_salarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_empleado ON rrhh_salarios(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_salarios_periodo  ON rrhh_salarios(tenant_id, periodo);
CREATE POLICY "rrhh_salarios_tenant" ON rrhh_salarios
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS rrhh_salario_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salario_id  UUID NOT NULL REFERENCES rrhh_salarios(id) ON DELETE CASCADE,
  concepto_id UUID REFERENCES rrhh_conceptos(id),
  descripcion TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('HABER', 'DESCUENTO')),
  monto       DECIMAL(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE rrhh_salario_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_items_salario ON rrhh_salario_items(salario_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_items_tenant  ON rrhh_salario_items(tenant_id);
CREATE POLICY "rrhh_salario_items_tenant" ON rrhh_salario_items
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION fn_recalcular_salario()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID;
  v_hab DECIMAL(12,2);
  v_des DECIMAL(12,2);
BEGIN
  v_id := CASE TG_OP WHEN 'DELETE' THEN OLD.salario_id ELSE NEW.salario_id END;
  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'HABER'     THEN monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'DESCUENTO' THEN monto ELSE 0 END), 0)
  INTO v_hab, v_des
  FROM rrhh_salario_items WHERE salario_id = v_id;
  UPDATE rrhh_salarios SET
    total_haberes = v_hab, total_descuentos = v_des, neto = v_hab - v_des, updated_at = NOW()
  WHERE id = v_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_salario
  AFTER INSERT OR UPDATE OR DELETE ON rrhh_salario_items
  FOR EACH ROW EXECUTE FUNCTION fn_recalcular_salario();

CREATE OR REPLACE FUNCTION pagar_nomina_empleado(p_salario_id UUID, p_sesion_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sal rrhh_salarios; v_emp empleados; v_mov UUID;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;
  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;
  IF NOT EXISTS (SELECT 1 FROM caja_sesiones WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta') THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;
  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (v_mov, v_sal.tenant_id, p_sesion_id, 'egreso', 'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'), v_sal.neto);
  UPDATE rrhh_salarios SET pagado=TRUE, fecha_pago=NOW(), caja_movimiento_id=v_mov, updated_at=NOW() WHERE id = p_salario_id;
  RETURN v_mov;
END;
$$;
-- ============================================================
-- Migration 018: RRHH Phase 2B — Vacaciones
-- Tablas: rrhh_vacaciones_solicitud · rrhh_vacaciones_saldo
-- Funciones: calcular_dias_habiles · aprobar_vacacion · rechazar_vacacion
-- ============================================================

-- ─── rrhh_vacaciones_solicitud ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rrhh_vacaciones_solicitud (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  desde         DATE NOT NULL,
  hasta         DATE NOT NULL,
  dias_habiles  INT NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','aprobada','rechazada')),
  notas         TEXT,
  aprobado_por  UUID REFERENCES users(id),
  aprobado_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_vacaciones_solicitud ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_tenant   ON rrhh_vacaciones_solicitud(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_empleado ON rrhh_vacaciones_solicitud(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sol_estado   ON rrhh_vacaciones_solicitud(tenant_id, estado);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_vacaciones_solicitud' AND policyname='rrhh_vac_sol_tenant') THEN
    CREATE POLICY "rrhh_vac_sol_tenant" ON rrhh_vacaciones_solicitud
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── rrhh_vacaciones_saldo ────────────────────────────────────────────────────
-- Saldo de vacaciones por empleado × año
CREATE TABLE IF NOT EXISTS rrhh_vacaciones_saldo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id        UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  anio               INT NOT NULL,
  dias_totales       INT NOT NULL DEFAULT 0,   -- días asignados este año
  dias_usados        INT NOT NULL DEFAULT 0,   -- días consumidos (aprobados)
  remanente_anterior INT NOT NULL DEFAULT 0,   -- días traídos del año anterior
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, empleado_id, anio)
);
ALTER TABLE rrhh_vacaciones_saldo ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sal_tenant   ON rrhh_vacaciones_saldo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_vac_sal_empleado ON rrhh_vacaciones_saldo(empleado_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_vacaciones_saldo' AND policyname='rrhh_vac_sal_tenant') THEN
    CREATE POLICY "rrhh_vac_sal_tenant" ON rrhh_vacaciones_saldo
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── updated_at triggers ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_vac_sol_updated_at' AND event_object_table = 'rrhh_vacaciones_solicitud'
  ) THEN
    CREATE TRIGGER trg_vac_sol_updated_at
      BEFORE UPDATE ON rrhh_vacaciones_solicitud
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_vac_sal_updated_at' AND event_object_table = 'rrhh_vacaciones_saldo'
  ) THEN
    CREATE TRIGGER trg_vac_sal_updated_at
      BEFORE UPDATE ON rrhh_vacaciones_saldo
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ─── calcular_dias_habiles (excluye sábado y domingo) ─────────────────────────
CREATE OR REPLACE FUNCTION calcular_dias_habiles(p_desde DATE, p_hasta DATE)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::INT
  FROM generate_series(p_desde, p_hasta, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);  -- 0=domingo, 6=sábado
$$;

-- ─── aprobar_vacacion ─────────────────────────────────────────────────────────
-- Aprueba una solicitud y descuenta del saldo anual (crea saldo si no existe).
CREATE OR REPLACE FUNCTION aprobar_vacacion(
  p_solicitud_id UUID,
  p_user_id      UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sol rrhh_vacaciones_solicitud;
  v_anio INT;
BEGIN
  SELECT * INTO v_sol FROM rrhh_vacaciones_solicitud WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  IF v_sol.estado != 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada';
  END IF;

  v_anio := EXTRACT(YEAR FROM v_sol.desde)::INT;

  -- Upsert saldo: incrementar dias_usados
  INSERT INTO rrhh_vacaciones_saldo (tenant_id, empleado_id, anio, dias_totales, dias_usados, remanente_anterior)
  VALUES (v_sol.tenant_id, v_sol.empleado_id, v_anio, 0, v_sol.dias_habiles, 0)
  ON CONFLICT (tenant_id, empleado_id, anio) DO UPDATE
    SET dias_usados = rrhh_vacaciones_saldo.dias_usados + v_sol.dias_habiles,
        updated_at  = NOW();

  -- Marcar como aprobada
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'aprobada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id;
END;
$$;

-- ─── rechazar_vacacion ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rechazar_vacacion(
  p_solicitud_id UUID,
  p_user_id      UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE rrhh_vacaciones_solicitud SET
    estado       = 'rechazada',
    aprobado_por = p_user_id,
    aprobado_at  = NOW(),
    updated_at   = NOW()
  WHERE id = p_solicitud_id AND estado = 'pendiente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada o ya procesada';
  END IF;
END;
$$;

-- ============================================================
-- Migration 019: RRHH Phase 3A — Asistencia
-- Tabla: rrhh_asistencia
-- ============================================================

-- ─── rrhh_asistencia ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rrhh_asistencia (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id   UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  fecha         DATE NOT NULL,
  hora_entrada  TIME,
  hora_salida   TIME,
  estado        TEXT NOT NULL DEFAULT 'presente'
                CHECK (estado IN ('presente','ausente','tardanza','licencia')),
  motivo        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, empleado_id, fecha)
);
ALTER TABLE rrhh_asistencia ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_tenant   ON rrhh_asistencia(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_empleado ON rrhh_asistencia(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_asist_fecha    ON rrhh_asistencia(tenant_id, fecha);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_asistencia' AND policyname='rrhh_asistencia_tenant') THEN
    CREATE POLICY "rrhh_asistencia_tenant" ON rrhh_asistencia
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── updated_at trigger ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_asistencia_updated_at' AND event_object_table = 'rrhh_asistencia'
  ) THEN
    CREATE TRIGGER trg_asistencia_updated_at
      BEFORE UPDATE ON rrhh_asistencia
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================
-- Migration 020: Marketplace Integration
-- ============================================================

-- ─── productos: campos marketplace ───────────────────────────────────────────
ALTER TABLE productos ADD COLUMN IF NOT EXISTS publicado_marketplace       BOOLEAN      DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_marketplace          DECIMAL(12,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_reservado_marketplace INT          DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS descripcion_marketplace     TEXT;

-- ─── tenants: configuración marketplace ──────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_activo      BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketplace_webhook_url TEXT;

-- Índice para consultar rápido los productos publicados por tenant
CREATE INDEX IF NOT EXISTS idx_productos_marketplace
  ON productos(tenant_id, publicado_marketplace)
  WHERE publicado_marketplace = TRUE;

-- ============================================================
-- Migration 021: Límite de movimientos por plan + add-ons
-- ============================================================

-- addon_movimientos: movimientos extra comprados por el tenant (se suman al límite del plan)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS addon_movimientos INT DEFAULT 0;

-- ============================================================
-- Migration 022: RRHH nombre/apellido + documentos empleado
-- ============================================================

-- Phase 2C: nombre y apellido en empleados
-- ALTER TABLE empleados ADD COLUMN IF NOT EXISTS nombre   TEXT NOT NULL DEFAULT '';  -- ya incluido arriba
-- ALTER TABLE empleados ADD COLUMN IF NOT EXISTS apellido TEXT;                      -- ya incluido arriba

-- Phase 4A: documentos por empleado
CREATE TABLE IF NOT EXISTS rrhh_documentos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  descripcion  TEXT,
  tipo         TEXT CHECK (tipo IN ('contrato','certificado','cv','foto','otro')) DEFAULT 'otro',
  storage_path TEXT NOT NULL,
  tamanio      BIGINT,
  mime_type    TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_documentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_documentos_tenant" ON rrhh_documentos
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_empleado ON rrhh_documentos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_documentos_tenant   ON rrhh_documentos(tenant_id);

-- Storage bucket empleados (privado, máx 10 MB)
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('empleados', 'empleados', false, 10485760, ARRAY['application/pdf',...])
-- ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Migration 023: RRHH Phase 4B — Capacitaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS rrhh_capacitaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  empleado_id      UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  descripcion      TEXT,
  fecha_inicio     DATE,
  fecha_fin        DATE,
  horas            DECIMAL(6,2),
  proveedor        TEXT,
  estado           TEXT CHECK (estado IN ('planificada','en_curso','completada','cancelada')) DEFAULT 'planificada',
  resultado        TEXT,
  certificado_path TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rrhh_capacitaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrhh_capacitaciones_tenant" ON rrhh_capacitaciones
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_rrhh_cap_empleado ON rrhh_capacitaciones(empleado_id);
CREATE INDEX IF NOT EXISTS idx_rrhh_cap_tenant   ON rrhh_capacitaciones(tenant_id);

-- ============================================================
-- Migration 024: RRHH Phase 5 — Supervisor Self-Service RLS
-- ============================================================

-- Función: IDs del equipo supervisado por el usuario actual
CREATE OR REPLACE FUNCTION get_supervisor_team_ids()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT e.id FROM empleados e
  WHERE e.supervisor_id = auth.uid()
    AND e.tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND e.activo = true
$$;

-- SUPERVISOR puede acceder a asistencia de su equipo
CREATE POLICY "rrhh_asistencia_supervisor" ON rrhh_asistencia
  FOR ALL
  USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
  WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));

-- SUPERVISOR puede acceder a vacaciones de su equipo
CREATE POLICY "rrhh_vac_supervisor" ON rrhh_vacaciones_solicitud
  FOR ALL
  USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
  WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));

CREATE POLICY "rrhh_vacsaldo_supervisor" ON rrhh_vacaciones_saldo
  FOR ALL
  USING  (empleado_id IN (SELECT get_supervisor_team_ids()))
  WITH CHECK (empleado_id IN (SELECT get_supervisor_team_ids()));

-- SUPERVISOR puede leer su equipo en la tabla empleados
CREATE POLICY "empleados_supervisor" ON empleados
  FOR SELECT
  USING (supervisor_id = auth.uid());


-- ─── Migration 025: Multi-sucursal ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sucursales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  direccion    TEXT,
  telefono     TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sucursales_tenant ON sucursales(tenant_id);
ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_sucursales ON sucursales
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE inventario_lineas  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE movimientos_stock  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE ventas             ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE caja_sesiones      ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE gastos             ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);
ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);

CREATE INDEX IF NOT EXISTS idx_inventario_lineas_sucursal ON inventario_lineas(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_sucursal ON movimientos_stock(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_ventas_sucursal            ON ventas(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_sucursal     ON caja_sesiones(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_gastos_sucursal            ON gastos(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_clientes_sucursal          ON clientes(sucursal_id);
