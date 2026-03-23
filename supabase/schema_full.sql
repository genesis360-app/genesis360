-- ============================================================
-- Stokio — Schema completo (extraído de PROD el 2026-03-19)
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
  descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  activo        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
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
