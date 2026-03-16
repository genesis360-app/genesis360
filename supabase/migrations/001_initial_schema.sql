-- ============================================================
-- StockApp - Migración inicial
-- Crear todas las tablas con Row Level Security habilitado
-- ============================================================

-- ============================================================
-- 1. PLANES
-- ============================================================
CREATE TABLE planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  max_users INT NOT NULL DEFAULT 2,
  precio_mensual DECIMAL(10,2) NOT NULL,
  mp_plan_id TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO planes (nombre, max_users, precio_mensual, activo) VALUES
  ('Básico',    2,     0.00, TRUE),
  ('Estándar',  5,  1500.00, TRUE),
  ('Avanzado',  999, 3000.00, TRUE);

-- ============================================================
-- 2. TENANTS (negocios)
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  tipo_comercio TEXT,
  pais TEXT DEFAULT 'AR',
  subscription_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial','active','inactive','cancelled')),
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  plan_id UUID REFERENCES planes(id),
  max_users INT NOT NULL DEFAULT 2,
  mp_subscription_id TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. USUARIOS (extiende auth.users)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  rol TEXT NOT NULL DEFAULT 'CAJERO'
    CHECK (rol IN ('OWNER','SUPERVISOR','CAJERO','ADMIN')),
  nombre_display TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. CATEGORÍAS
-- ============================================================
CREATE TABLE categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. PROVEEDORES
-- ============================================================
CREATE TABLE proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. UBICACIONES
-- ============================================================
CREATE TABLE ubicaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. PRODUCTOS
-- ============================================================
CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  sku TEXT NOT NULL,
  descripcion TEXT,
  categoria_id UUID REFERENCES categorias(id),
  proveedor_id UUID REFERENCES proveedores(id),
  ubicacion_id UUID REFERENCES ubicaciones(id),
  precio_costo DECIMAL(12,2) DEFAULT 0,
  precio_venta DECIMAL(12,2) DEFAULT 0,
  margen_ganancia DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE WHEN precio_costo > 0
      THEN ROUND(((precio_venta - precio_costo) / precio_costo) * 100, 2)
      ELSE 0
    END
  ) STORED,
  stock_actual INT NOT NULL DEFAULT 0,
  stock_minimo INT NOT NULL DEFAULT 0,
  unidad_medida TEXT DEFAULT 'unidad',
  codigo_barras TEXT,
  imagen_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_productos_tenant ON productos(tenant_id);
CREATE INDEX idx_productos_sku ON productos(tenant_id, sku);
CREATE INDEX idx_productos_categoria ON productos(categoria_id);

-- ============================================================
-- 8. MOVIMIENTOS DE STOCK
-- ============================================================
CREATE TABLE movimientos_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','rebaje','ajuste')),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  stock_antes INT NOT NULL,
  stock_despues INT NOT NULL,
  motivo TEXT,
  proveedor_id UUID REFERENCES proveedores(id),
  usuario_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE movimientos_stock ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_movimientos_tenant ON movimientos_stock(tenant_id);
CREATE INDEX idx_movimientos_producto ON movimientos_stock(producto_id);
CREATE INDEX idx_movimientos_fecha ON movimientos_stock(created_at);

-- ============================================================
-- 9. ALERTAS
-- ============================================================
CREATE TABLE alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL DEFAULT 'stock_minimo',
  mensaje TEXT,
  resuelta BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_alertas_tenant ON alertas(tenant_id, resuelta);

-- ============================================================
-- 10. RLS POLICIES
-- ============================================================

-- Helper function: obtiene tenant_id del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: obtiene el rol del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT rol FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- TENANTS
CREATE POLICY "tenant_select" ON tenants FOR SELECT
  USING (id = get_user_tenant_id() OR get_user_role() = 'ADMIN');

CREATE POLICY "tenant_update" ON tenants FOR UPDATE
  USING (id = get_user_tenant_id() AND get_user_role() IN ('OWNER','ADMIN'));

-- USERS
CREATE POLICY "users_select_own_tenant" ON users FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR get_user_role() = 'ADMIN');

CREATE POLICY "users_insert_owner" ON users FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','ADMIN'));

CREATE POLICY "users_update_owner" ON users FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','ADMIN'));

-- CATEGORÍAS
CREATE POLICY "categorias_tenant" ON categorias FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- PROVEEDORES
CREATE POLICY "proveedores_tenant" ON proveedores FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- UBICACIONES
CREATE POLICY "ubicaciones_tenant" ON ubicaciones FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- PRODUCTOS
CREATE POLICY "productos_select" ON productos FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "productos_insert" ON productos FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','SUPERVISOR'));

CREATE POLICY "productos_update" ON productos FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('OWNER','SUPERVISOR'));

CREATE POLICY "productos_delete" ON productos FOR DELETE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'OWNER');

-- MOVIMIENTOS
CREATE POLICY "movimientos_select" ON movimientos_stock FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "movimientos_insert" ON movimientos_stock FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ALERTAS
CREATE POLICY "alertas_tenant" ON alertas FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- ============================================================
-- 11. TRIGGER: actualizar updated_at en productos
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_updated_at
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 12. TRIGGER: crear alerta cuando stock baja al mínimo
-- ============================================================
CREATE OR REPLACE FUNCTION check_stock_minimo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_actual <= NEW.stock_minimo THEN
    INSERT INTO alertas (tenant_id, producto_id, tipo, mensaje)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      'stock_minimo',
      'Stock de ' || NEW.nombre || ' llegó al mínimo (' || NEW.stock_actual || ' unidades)'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_stock_check
  AFTER UPDATE OF stock_actual ON productos
  FOR EACH ROW EXECUTE FUNCTION check_stock_minimo();
