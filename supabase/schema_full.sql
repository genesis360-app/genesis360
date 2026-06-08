-- ============================================================
-- Genesis360 — Schema completo (actualizado 2026-03-26, migrations 001–024)
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
  session_timeout_minutes   INT DEFAULT NULL,
  envio_peso_fuente         TEXT NOT NULL DEFAULT 'manual'  -- ISS-174 (mig 162) — 'manual' | 'producto'
    CHECK (envio_peso_fuente IN ('manual','producto')),
  reglas_canal              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- VF2/I2 (mig 168) — reglas por clasificación online/presencial
  alerta_margen_negativo    BOOLEAN NOT NULL DEFAULT TRUE,       -- VF4/K2 (mig 170)
  alerta_devoluciones_n     INT,                                -- VF4/K2 (mig 170) — NULL = off
  alerta_devoluciones_dias  INT NOT NULL DEFAULT 30,            -- VF4/K2 (mig 170)
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
    CHECK (rol IN ('DUEÑO','SUPER_USUARIO','SUPERVISOR','CAJERO','ADMIN','RRHH','DEPOSITO','CONTADOR')),
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
  es_devolucion       BOOLEAN NOT NULL DEFAULT false,
  -- WMS Fase 2 (migration 032)
  tipo_ubicacion      TEXT CHECK (tipo_ubicacion IN ('picking','bulk','estiba','camara','cross_dock')),
  alto_cm             DECIMAL(8,2),
  ancho_cm            DECIMAL(8,2),
  largo_cm            DECIMAL(8,2),
  peso_max_kg         DECIMAL(8,2),
  capacidad_pallets   INT,
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
  precio_usd       DECIMAL(12,2),              -- G5 (mig 161) — precio en USD si moneda_venta='usd'
  moneda_venta     TEXT NOT NULL DEFAULT 'local', -- G5 (mig 161) — 'local' | 'usd' (convierte en POS)
  peso_kg          DECIMAL(10,3),  -- ISS-174 (mig 164) — peso unitario para cotizar envíos (fuente 'producto')
  largo_cm         DECIMAL(10,2),  -- ISS-174 (mig 164)
  ancho_cm         DECIMAL(10,2),  -- ISS-174 (mig 164)
  alto_cm          DECIMAL(10,2),  -- ISS-174 (mig 164)
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
  gtin             TEXT,  -- mig 158: GS1 GTIN (AI 01) para códigos compuestos; fallback codigo_barras
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
  notas              TEXT,
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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  dni         TEXT,  -- DNI/RUT del cliente; único por tenant (WHERE dni IS NOT NULL); obligatorio en UI
  telefono    TEXT,
  email       TEXT,
  notas       TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  motivo_baja TEXT,                          -- CL1/A6 (mig 171) — razón de la baja (soft delete)
  baja_at     TIMESTAMPTZ,                    -- CL1/A6 (mig 171)
  baja_por    UUID REFERENCES users(id),      -- CL1/A6 (mig 171)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clientes_dni_tenant ON clientes(tenant_id, dni) WHERE dni IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(tenant_id) WHERE activo;  -- CL1 (mig 171)
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 16. VENTAS
-- ============================================================
CREATE TABLE ventas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero          INT NOT NULL,
  numero_sucursal INTEGER,                      -- correlativo local por sucursal (mig 108)
  presupuesto_numero          INTEGER,          -- correlativo independiente de presupuestos (mig 159, F5)
  presupuesto_numero_sucursal INTEGER,          -- correlativo de presupuestos por sucursal (mig 159, F5)
  cliente_id      UUID REFERENCES clientes(id),
  cliente_nombre  TEXT,
  cliente_telefono TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente',
  consumidor_final BOOLEAN NOT NULL DEFAULT TRUE,  -- VF1/H5 (mig 167) — venta a Consumidor Final vs cliente registrado
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  medio_pago      TEXT,
  monto_pagado    DECIMAL(12,2) NOT NULL DEFAULT 0,  -- acumula cobros parciales (reservas)
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

-- Trigger: auto-generar numero de venta por tenant (mig 108: numero_sucursal · mig 159: presupuesto_numero)
CREATE OR REPLACE FUNCTION gen_venta_numero()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
    FROM ventas WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  -- F5: correlativo independiente de presupuestos (solo si nace como presupuesto)
  IF NEW.estado = 'pendiente' AND NEW.presupuesto_numero IS NULL THEN
    SELECT COALESCE(MAX(presupuesto_numero), 0) + 1 INTO NEW.presupuesto_numero
    FROM ventas WHERE tenant_id = NEW.tenant_id AND presupuesto_numero IS NOT NULL;
    IF NEW.sucursal_id IS NOT NULL THEN
      SELECT COALESCE(MAX(presupuesto_numero_sucursal), 0) + 1 INTO NEW.presupuesto_numero_sucursal
      FROM ventas WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id
        AND presupuesto_numero_sucursal IS NOT NULL;
    END IF;
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
  cantidad               DECIMAL(14,4) NOT NULL DEFAULT 1,
  precio_unitario        DECIMAL(12,2) NOT NULL,
  descuento              DECIMAL(5,2) NOT NULL DEFAULT 0,
  subtotal               DECIMAL(12,2) NOT NULL,
  precio_costo_historico DECIMAL(14,2),
  lpn_plan               JSONB,  -- mig 156: plan de LPN del carrito [{linea_id,lpn,cantidad,manual}] para honrar al despachar reservas
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

-- ISS-075 (mig 153): desglose de despacho por LPN/ubicación de cada venta_item
CREATE TABLE venta_item_despachos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id         UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  venta_item_id    UUID NOT NULL REFERENCES venta_items(id) ON DELETE CASCADE,
  producto_id      UUID REFERENCES productos(id) ON DELETE SET NULL,
  linea_id         UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  lpn              TEXT,
  ubicacion_id     UUID,
  ubicacion_nombre TEXT,
  cantidad         NUMERIC NOT NULL,
  nro_serie        TEXT,
  origen           TEXT,           -- ISS-075 (mig 154): 'manual' | 'auto' | NULL (legacy)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE venta_item_despachos ENABLE ROW LEVEL SECURITY;
-- ISS-075 (mig 154): toggle de captura de trazabilidad → tenants.trazabilidad_asignacion BOOLEAN DEFAULT TRUE

CREATE INDEX idx_vid_venta  ON venta_item_despachos(venta_id);
CREATE INDEX idx_vid_item   ON venta_item_despachos(venta_item_id);
CREATE INDEX idx_vid_tenant ON venta_item_despachos(tenant_id);

-- ============================================================
-- 19. CAJAS
-- ============================================================
CREATE TABLE cajas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  activo          BOOLEAN DEFAULT TRUE,
  es_caja_fuerte  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
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
-- 21B. CAJA TRASPASOS
-- ============================================================
CREATE TABLE caja_traspasos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_origen_id    UUID NOT NULL REFERENCES caja_sesiones(id),
  sesion_destino_id   UUID NOT NULL REFERENCES caja_sesiones(id),
  monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  concepto            TEXT,
  usuario_id          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE caja_traspasos ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_traspasos_origen  ON caja_traspasos(sesion_origen_id);
CREATE INDEX idx_traspasos_destino ON caja_traspasos(sesion_destino_id);
CREATE INDEX idx_traspasos_tenant  ON caja_traspasos(tenant_id);

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
     EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND rol IN ('DUEÑO','ADMIN')))
    OR is_admin()
  );

-- USERS
CREATE POLICY "users_select" ON users FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_admin());
CREATE POLICY "users_insert_self" ON users FOR INSERT
  WITH CHECK (id = auth.uid());
CREATE POLICY "users_insert_owner" ON users FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('DUEÑO','ADMIN'));
CREATE POLICY "users_update_owner" ON users FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('DUEÑO','ADMIN'));

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
--     -d '{"id": "productos", "name": "productos", "public": true, "file_size_limit": 5242880, "allowed_mime_types": ["image/jpeg","image/png","image/webp"]}'
--
-- Límites: file_size_limit=5 MB · allowed_mime_types: image/jpeg, image/png, image/webp
-- Path en el bucket: {tenant_id}/{timestamp}.{ext}
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

-- DELETE: verifica que el primer segmento del path = tenant_id del usuario
DO $$ BEGIN
  CREATE POLICY delete_productos ON storage.objects
    FOR DELETE USING (
      bucket_id = 'productos'
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM users WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Límites del bucket (migration 027)
UPDATE storage.buckets
SET
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'productos';

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
  -- Ledger / trazabilidad-extendida (mig 155)
  transaccion_id    UUID,   -- cabecera logica: agrupa las filas de UNA accion del usuario
  tipo_transaccion  TEXT,   -- ingreso/rebaje/traslado/ajuste/edicion/venta/devolucion/eliminacion
  producto_id       UUID,
  lpn               TEXT,   -- snapshot del LPN afectado (recall por unidad)
  nro_serie         TEXT,   -- snapshot de la serie afectada
  lote              TEXT,   -- snapshot del lote afectado
  sucursal_id       UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS actividad_log_tenant_idx  ON actividad_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS actividad_log_entidad_idx ON actividad_log (tenant_id, entidad);
CREATE INDEX IF NOT EXISTS actividad_log_usuario_idx ON actividad_log (tenant_id, usuario_id);
CREATE INDEX IF NOT EXISTS actividad_log_transaccion_idx ON actividad_log (transaccion_id);
CREATE INDEX IF NOT EXISTS actividad_log_producto_idx ON actividad_log (tenant_id, producto_id);
CREATE INDEX IF NOT EXISTS actividad_log_lpn_idx       ON actividad_log (tenant_id, lpn);
CREATE INDEX IF NOT EXISTS actividad_log_serie_idx     ON actividad_log (tenant_id, nro_serie);
ALTER TABLE actividad_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actividad_log_insert" ON actividad_log
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
CREATE POLICY "actividad_log_select" ON actividad_log
  FOR SELECT USING (
    is_admin()
    OR tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND rol IN ('DUEÑO', 'SUPERVISOR'))
  );

-- ============================================================
-- CÓDIGO PERFILES (ISS-127, mig 157) — perfiles de códigos compuestos GS1/custom
-- ============================================================
CREATE TABLE IF NOT EXISTS codigo_perfiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  proveedor_id  UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL DEFAULT 'gs1',          -- 'gs1' | 'custom'
  simbologia    TEXT NOT NULL DEFAULT 'gs1_128',      -- 'gs1_128' | 'datamatrix'
  ais           JSONB NOT NULL DEFAULT '["01","10","17","30"]'::jsonb,
  custom_format JSONB,
  lectura_modo  TEXT NOT NULL DEFAULT 'autocompletar', -- 'autocompletar' | 'directo'
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_codigo_perfiles_tenant    ON codigo_perfiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_codigo_perfiles_proveedor ON codigo_perfiles(tenant_id, proveedor_id);
ALTER TABLE codigo_perfiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='codigo_perfiles_tenant' AND tablename='codigo_perfiles') THEN
    CREATE POLICY "codigo_perfiles_tenant" ON codigo_perfiles FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- COURIER CREDENCIALES (ISS-174, mig 162) — credenciales de API de courier por tenant
-- Los secretos en `credenciales` solo se usan server-side (Edge Functions); el front
-- no debe seleccionarlos en flujos de cotización. La UI de Config (owner-only) los edita.
-- ============================================================
CREATE TABLE IF NOT EXISTS courier_credenciales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  courier      TEXT NOT NULL,                       -- 'Andreani' | 'Correo Argentino' | 'OCA' | ...
  credenciales JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {client_id, client_secret, usuario, password, nro_contrato, ...}
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, courier)
);
CREATE INDEX IF NOT EXISTS idx_courier_credenciales_tenant ON courier_credenciales(tenant_id);
ALTER TABLE courier_credenciales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='courier_credenciales_tenant' AND tablename='courier_credenciales') THEN
    CREATE POLICY "courier_credenciales_tenant" ON courier_credenciales FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- CANALES DE VENTA (VF2/I1, mig 168) — canales por tenant + clasificación online/presencial
-- Seed automático al alta del tenant vía trigger SECURITY DEFINER (ver mig 168). MP no es canal.
-- ============================================================
CREATE TABLE IF NOT EXISTS canales_venta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  clasificacion TEXT NOT NULL DEFAULT 'presencial' CHECK (clasificacion IN ('online','presencial')),
  icono         TEXT,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  predefinido   BOOLEAN NOT NULL DEFAULT FALSE,
  orden         INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_canales_venta_tenant ON canales_venta(tenant_id);
ALTER TABLE canales_venta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='canales_venta_tenant' AND tablename='canales_venta') THEN
    CREATE POLICY "canales_venta_tenant" ON canales_venta FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ============================================================
-- VENTA AUDITORIA (VF3/J1, mig 169) — audit log detallado por venta
-- ============================================================
CREATE TABLE IF NOT EXISTS venta_auditoria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  accion          TEXT NOT NULL,
  detalle         JSONB,
  usuario_id      UUID,
  usuario_nombre  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_venta_auditoria_venta ON venta_auditoria(venta_id, created_at);
ALTER TABLE venta_auditoria ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='venta_auditoria_tenant' AND tablename='venta_auditoria') THEN
    CREATE POLICY "venta_auditoria_tenant" ON venta_auditoria FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

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

-- Helper function para validar que usuario es RRHH o Dueño
CREATE OR REPLACE FUNCTION public.is_rrhh()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND (rol = 'RRHH' OR rol = 'DUEÑO')
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
  supervisor_id   UUID REFERENCES empleados(id) ON DELETE SET NULL, -- migration 147
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
-- migration 151: 1 user del sistema solo puede vincularse a 1 empleado por tenant
CREATE UNIQUE INDEX IF NOT EXISTS empleados_tenant_user_unique
  ON empleados(tenant_id, user_id) WHERE user_id IS NOT NULL;

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
  medio_pago         TEXT DEFAULT 'efectivo' CHECK (medio_pago IN ('efectivo','transferencia_banco','mp')),
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

CREATE OR REPLACE FUNCTION pagar_nomina_empleado(
  p_salario_id UUID,
  p_sesion_id  UUID,
  p_medio_pago TEXT DEFAULT 'efectivo'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sal rrhh_salarios; v_emp empleados; v_mov UUID;
  v_apertura NUMERIC; v_ingresos NUMERIC; v_egresos NUMERIC; v_saldo NUMERIC;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;
  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;
  IF NOT EXISTS (SELECT 1 FROM caja_sesiones WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta') THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;
  IF p_medio_pago = 'efectivo' THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo = 'egreso'   THEN monto ELSE 0 END), 0)
    INTO v_ingresos, v_egresos
    FROM caja_movimientos WHERE sesion_id = p_sesion_id;
    v_saldo := v_apertura + v_ingresos - v_egresos;
    IF v_saldo < v_sal.neto THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponible $%, necesita $%', ROUND(v_saldo), ROUND(v_sal.neto);
    END IF;
  END IF;
  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (v_mov, v_sal.tenant_id, p_sesion_id, 'egreso',
    'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'), v_sal.neto);
  UPDATE rrhh_salarios
  SET pagado = TRUE, fecha_pago = NOW(), caja_movimiento_id = v_mov,
      medio_pago = p_medio_pago, updated_at = NOW()
  WHERE id = p_salario_id;
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

-- ─── Migration 031: Maestro de estructura de producto ─────────────────────────

CREATE TABLE IF NOT EXISTS producto_estructuras (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id     UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre          TEXT        NOT NULL,
  is_default      BOOLEAN     NOT NULL DEFAULT false,
  unidades_por_caja   INT,
  cajas_por_pallet    INT,
  peso_unidad    DECIMAL(10,4),
  alto_unidad    DECIMAL(10,2),
  ancho_unidad   DECIMAL(10,2),
  largo_unidad   DECIMAL(10,2),
  peso_caja      DECIMAL(10,4),
  alto_caja      DECIMAL(10,2),
  ancho_caja     DECIMAL(10,2),
  largo_caja     DECIMAL(10,2),
  peso_pallet    DECIMAL(10,4),
  alto_pallet    DECIMAL(10,2),
  ancho_pallet   DECIMAL(10,2),
  largo_pallet   DECIMAL(10,2),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_estructuras_default
  ON producto_estructuras (tenant_id, producto_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_producto_estructuras_producto ON producto_estructuras (producto_id);
CREATE INDEX IF NOT EXISTS idx_producto_estructuras_tenant   ON producto_estructuras (tenant_id);

-- ─── Migration 036: rrhh_feriados ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rrhh_feriados (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  fecha      DATE NOT NULL,
  tipo       TEXT DEFAULT 'nacional' CHECK (tipo IN ('nacional', 'provincial', 'personalizado', 'no_laborable')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_feriados ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_feriados_tenant_fecha ON rrhh_feriados(tenant_id, fecha);

-- ─── Migration 037: roles_custom ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles_custom (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  permisos   JSONB NOT NULL DEFAULT '{}',
  activo     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, nombre)
);
ALTER TABLE roles_custom ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_roles_custom_tenant ON roles_custom(tenant_id);
-- FK en users
ALTER TABLE users ADD COLUMN IF NOT EXISTS rol_custom_id UUID REFERENCES roles_custom(id) ON DELETE SET NULL;

-- ─── Migration 038: movimientos_stock links ───────────────────────────────────
ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES ventas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_venta_id ON movimientos_stock(venta_id) WHERE venta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_stock_gasto_id ON movimientos_stock(gasto_id) WHERE gasto_id IS NOT NULL;

-- ─── Migration 039: caja_arqueos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caja_arqueos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sesion_id        UUID NOT NULL REFERENCES caja_sesiones(id) ON DELETE CASCADE,
  saldo_calculado  DECIMAL(12,2) NOT NULL,
  saldo_real       DECIMAL(12,2) NOT NULL,
  diferencia       DECIMAL(12,2) GENERATED ALWAYS AS (saldo_real - saldo_calculado) STORED,
  notas            TEXT,
  usuario_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE caja_arqueos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_caja_arqueos_sesion  ON caja_arqueos(sesion_id);
CREATE INDEX IF NOT EXISTS idx_caja_arqueos_tenant  ON caja_arqueos(tenant_id, created_at DESC);

-- ─── Migration 040: KITs / Kitting (WMS Fase 2.5) ────────────────────────────
ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_kit BOOLEAN DEFAULT FALSE;
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
  CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting'));

CREATE TABLE IF NOT EXISTS kit_recetas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kit_producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  comp_producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad         DECIMAL(12,3) NOT NULL CHECK (cantidad > 0),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kit_producto_id, comp_producto_id)
);
ALTER TABLE kit_recetas ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_kit_recetas_kit    ON kit_recetas(kit_producto_id);
CREATE INDEX IF NOT EXISTS idx_kit_recetas_comp   ON kit_recetas(comp_producto_id);
CREATE INDEX IF NOT EXISTS idx_kit_recetas_tenant ON kit_recetas(tenant_id);

CREATE TABLE IF NOT EXISTS kitting_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kit_producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_kits    DECIMAL(12,3) NOT NULL CHECK (cantidad_kits > 0),
  ubicacion_id     UUID REFERENCES ubicaciones(id) ON DELETE SET NULL,
  usuario_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notas            TEXT,
  tipo             TEXT DEFAULT 'armado' CHECK (tipo IN ('armado', 'desarmado')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE kitting_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_kitting_log_tenant ON kitting_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kitting_log_kit    ON kitting_log(kit_producto_id);

-- ─── Migration 041: session_timeout + des_kitting ────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS session_timeout_minutes INT DEFAULT NULL;
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
  CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting', 'des_kitting', 'ajuste_ingreso', 'ajuste_rebaje', 'traslado'));
ALTER TABLE kitting_log ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'armado' CHECK (tipo IN ('armado', 'desarmado'));

-- ─── Migration 042: IVA + archivos_biblioteca + auto-resolve alertas ─────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2) NOT NULL DEFAULT 21
    CHECK (alicuota_iva IN (0, 10.5, 21, 27));

ALTER TABLE venta_items
  ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS iva_monto    DECIMAL(12,2);

ALTER TABLE inventario_lineas
  ADD COLUMN IF NOT EXISTS precio_venta_snapshot DECIMAL(14,2);

ALTER TABLE motivos_movimiento
  ADD COLUMN IF NOT EXISTS es_sistema BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE motivos_movimiento SET es_sistema = TRUE WHERE LOWER(nombre) = 'ventas';

CREATE OR REPLACE FUNCTION public.auto_resolver_alerta_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.stock_actual > NEW.stock_minimo THEN
    UPDATE alertas SET resuelta = TRUE
    WHERE producto_id = NEW.id AND tipo = 'stock_minimo' AND resuelta = FALSE;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'productos_stock_auto_resolver') THEN
    CREATE TRIGGER productos_stock_auto_resolver
      AFTER UPDATE OF stock_actual ON productos
      FOR EACH ROW EXECUTE FUNCTION auto_resolver_alerta_stock();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS archivos_biblioteca (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'otro'
    CHECK (tipo IN ('certificado_afip_crt','certificado_afip_key','contrato','factura_proveedor','manual','otro')),
  descripcion   TEXT,
  storage_path  TEXT NOT NULL,
  tamanio       BIGINT,
  mime_type     TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE archivos_biblioteca ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_archivos_biblioteca_tenant ON archivos_biblioteca(tenant_id, tipo);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'archivos_biblioteca' AND policyname = 'archivos_biblioteca_tenant') THEN
    CREATE POLICY "archivos_biblioteca_tenant" ON archivos_biblioteca
      FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('archivos-biblioteca', 'archivos-biblioteca', false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── Migration 043: Certificados AFIP ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_certificates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cert_crt_path       TEXT NOT NULL,
  cert_key_path       TEXT NOT NULL,
  cuit                TEXT,
  fecha_validez_hasta DATE,
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);
ALTER TABLE tenant_certificates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tenant_certificates_tenant ON tenant_certificates(tenant_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificados-afip', 'certificados-afip', false, 1048576,
  ARRAY['application/x-pem-file', 'application/octet-stream', 'application/x-x509-ca-cert'])
ON CONFLICT (id) DO NOTHING;

-- ─── Migration 045: Métodos de pago configurables ─────────────────────────────
CREATE TABLE IF NOT EXISTS metodos_pago (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6b7280',
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  es_sistema  BOOLEAN NOT NULL DEFAULT FALSE,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, nombre)
);
ALTER TABLE metodos_pago ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_metodos_pago_tenant ON metodos_pago(tenant_id);

-- ─── Migration 058: Ampliar users.rol CHECK ──────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'RRHH', 'DEPOSITO', 'CONTADOR'));

-- ─── Migration 057: Sprint D — LPN Madre ─────────────────────────────────────
ALTER TABLE inventario_lineas ADD COLUMN IF NOT EXISTS parent_lpn_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_lineas_parent_lpn
  ON inventario_lineas(tenant_id, parent_lpn_id)
  WHERE parent_lpn_id IS NOT NULL;

-- ─── Migration 055: movimientos_stock tipos + DECIMAL cantidad ────────────────
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_tipo_check;
ALTER TABLE movimientos_stock ADD CONSTRAINT movimientos_stock_tipo_check
  CHECK (tipo IN ('ingreso', 'rebaje', 'ajuste', 'kitting', 'des_kitting', 'ajuste_ingreso', 'ajuste_rebaje', 'traslado'));
ALTER TABLE movimientos_stock
  ALTER COLUMN cantidad TYPE DECIMAL(14,4) USING cantidad::DECIMAL(14,4);

-- ─── Migration 056: Sprint C — Tab Autorizaciones DEPOSITO ───────────────────
CREATE TABLE IF NOT EXISTS autorizaciones_inventario (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('ajuste_cantidad', 'eliminar_serie', 'eliminar_lpn')),
  linea_id         UUID NOT NULL REFERENCES inventario_lineas(id),
  datos_cambio     JSONB NOT NULL DEFAULT '{}',
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por   UUID REFERENCES users(id),
  aprobado_por     UUID REFERENCES users(id),
  motivo_rechazo   TEXT,
  notas            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE autorizaciones_inventario ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autorizaciones_inventario' AND policyname = 'aut_inv_tenant'
  ) THEN
    CREATE POLICY aut_inv_tenant ON autorizaciones_inventario
      FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_aut_inv_tenant_estado ON autorizaciones_inventario(tenant_id, estado);
CREATE TRIGGER trg_updated_at_aut_inv
  BEFORE UPDATE ON autorizaciones_inventario
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- ─── Migration 060: Fase 0 — Fundamentos de Integraciones ───────────────────
-- Prerequisito para todas las integraciones externas (MELI, TN, MP, etc.)
-- 1. pgcrypto (encriptación de tokens)
-- 2. ventas — columnas adicionales para e-commerce
-- 3. clientes — normalización y marketing
-- 4. integration_job_queue — cola genérica async
-- 5. ventas_externas_logs — idempotencia de webhooks
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. pgcrypto (necesario para PGP_SYM_ENCRYPT en tablas de credenciales)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ventas — columnas para origen, tracking y facturación
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'POS',
  ADD COLUMN IF NOT EXISTS tracking_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS costo_envio_logistica DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS marketing_metadata JSONB,
  ADD COLUMN IF NOT EXISTS id_pago_externo TEXT,
  ADD COLUMN IF NOT EXISTS money_release_date DATE,
  ADD COLUMN IF NOT EXISTS cae VARCHAR,
  ADD COLUMN IF NOT EXISTS vencimiento_cae DATE,
  ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS link_factura_pdf TEXT;

-- origen: de dónde vino la venta (canal). Constraint eliminada en mig 174:
-- desde mig 168 el canal es configurable por tenant (catálogo canales_venta),
-- texto libre validado a nivel de app. NO recrear la CHECK.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. clientes — normalización de teléfono y optin de marketing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS telefono_normalizado TEXT,
  ADD COLUMN IF NOT EXISTS marketing_optin BOOLEAN DEFAULT TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. integration_job_queue — cola async genérica para todas las integraciones
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_job_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  integracion     TEXT NOT NULL,  -- 'meli' | 'tiendanube' | 'mp' | 'andreani' | etc.
  tipo            TEXT NOT NULL,  -- 'sync_stock' | 'sync_precio' | 'crear_envio' | etc.
  payload         JSONB NOT NULL DEFAULT '{}',
  endpoint        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  retries         INT NOT NULL DEFAULT 0,
  max_retries     INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_last      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON integration_job_queue (tenant_id, integracion, next_attempt_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE integration_job_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_job_queue' AND policyname = 'job_queue_tenant'
  ) THEN
    CREATE POLICY job_queue_tenant ON integration_job_queue
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_job_queue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_job_queue ON integration_job_queue;
CREATE TRIGGER trg_updated_at_job_queue
  BEFORE UPDATE ON integration_job_queue
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_job_queue();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ventas_externas_logs — idempotencia de webhooks entrantes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventas_externas_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integracion          TEXT NOT NULL,  -- 'meli' | 'tiendanube' | 'mp' | etc.
  webhook_external_id  TEXT NOT NULL,  -- ID único del evento en la plataforma externa
  venta_id             UUID REFERENCES ventas(id) ON DELETE SET NULL,
  payload_raw          JSONB,
  procesado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, integracion, webhook_external_id)
);

CREATE INDEX IF NOT EXISTS idx_ventas_externas_logs_lookup
  ON ventas_externas_logs (tenant_id, integracion, webhook_external_id);

ALTER TABLE ventas_externas_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ventas_externas_logs' AND policyname = 'ventas_externas_tenant'
  ) THEN
    CREATE POLICY ventas_externas_tenant ON ventas_externas_logs
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── Migration 061: Credenciales TiendaNube + MercadoPago + Mapeo TN ─────────
-- Tablas de credenciales OAuth por sucursal.
-- SEGURIDAD: access_token y campos sensibles nunca expuestos al frontend.
-- Las Edge Functions los leen vía service role key.
-- El frontend solo consulta campos de estado (conectado, store_id, expires_at).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tiendanube_credentials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiendanube_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  store_id        BIGINT NOT NULL,           -- ID de la tienda en TN
  store_name      TEXT,                      -- nombre visible al usuario
  store_url       TEXT,                      -- URL de la tienda (ej: mitienda.mitiendanube.com)
  access_token    TEXT NOT NULL,             -- token permanente (sin expiración en TN)
  conectado       BOOLEAN NOT NULL DEFAULT TRUE,
  conectado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_tn_creds_tenant ON tiendanube_credentials (tenant_id);

ALTER TABLE tiendanube_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tiendanube_credentials' AND policyname = 'tn_creds_tenant'
  ) THEN
    -- Solo Dueño/SUPERVISOR pueden ver el estado de conexión (no los tokens)
    CREATE POLICY tn_creds_tenant ON tiendanube_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_tn_creds()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_tn_creds ON tiendanube_credentials;
CREATE TRIGGER trg_updated_at_tn_creds
  BEFORE UPDATE ON tiendanube_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_tn_creds();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. mercadopago_credentials
-- Solo para recibir notificaciones IPN de pagos (no cobrar en nombre de otros).
-- access_token del vendedor obtenido vía OAuth estándar de MP.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mercadopago_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  seller_id       BIGINT NOT NULL,           -- user_id de MP del vendedor
  seller_email    TEXT,                      -- email de la cuenta MP
  access_token    TEXT NOT NULL,             -- token OAuth del vendedor
  refresh_token   TEXT,                      -- para renovar (expira en 180 días en MP)
  public_key      TEXT,                      -- public_key del vendedor (para checkout)
  expires_at      TIMESTAMPTZ,               -- cuándo vence el access_token
  conectado       BOOLEAN NOT NULL DEFAULT TRUE,
  conectado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_creds_tenant ON mercadopago_credentials (tenant_id);
-- Índice para encontrar tokens próximos a vencer (cron de refresh)
CREATE INDEX IF NOT EXISTS idx_mp_creds_expires ON mercadopago_credentials (expires_at)
  WHERE conectado = TRUE;

ALTER TABLE mercadopago_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mercadopago_credentials' AND policyname = 'mp_creds_tenant'
  ) THEN
    CREATE POLICY mp_creds_tenant ON mercadopago_credentials
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_updated_at_mp_creds()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_mp_creds ON mercadopago_credentials;
CREATE TRIGGER trg_updated_at_mp_creds
  BEFORE UPDATE ON mercadopago_credentials
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at_mp_creds();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inventario_tn_map — mapeo producto Genesis360 ↔ producto TiendaNube
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_tn_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  tn_product_id   BIGINT NOT NULL,           -- ID del producto en TN
  tn_variant_id   BIGINT,                    -- ID de la variante (null si sin variantes)
  sync_stock      BOOLEAN NOT NULL DEFAULT TRUE,   -- sincronizar stock hacia TN
  sync_precio     BOOLEAN NOT NULL DEFAULT FALSE,  -- sincronizar precio hacia TN
  ultimo_sync_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, sucursal_id, producto_id),
  UNIQUE (tenant_id, sucursal_id, tn_product_id, tn_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_tn_map_producto ON inventario_tn_map (tenant_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_tn_map_tn_product ON inventario_tn_map (tenant_id, tn_product_id);

ALTER TABLE inventario_tn_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventario_tn_map' AND policyname = 'tn_map_tenant'
  ) THEN
    CREATE POLICY tn_map_tenant ON inventario_tn_map
      USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 083: Cuenta Corriente Clientes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS limite_credito DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INT DEFAULT 30;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS es_cuenta_corriente BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ventas_cc ON ventas(tenant_id, es_cuenta_corriente) WHERE es_cuenta_corriente = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 084: Notificaciones + Caja Fuerte + Apertura Caja
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificaciones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'info' CHECK (tipo IN ('info','warning','danger','success')),
  titulo      TEXT NOT NULL,
  mensaje     TEXT NOT NULL,
  leida       BOOLEAN NOT NULL DEFAULT FALSE,
  action_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_user_id ON notificaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida   ON notificaciones(user_id, leida) WHERE leida = FALSE;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_user ON notificaciones FOR ALL USING (user_id = auth.uid());

ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS monto_sugerido_apertura DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS diferencia_apertura     DECIMAL(12,2);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS caja_fuerte_roles TEXT[] DEFAULT ARRAY['DUEÑO','SUPERVISOR','ADMIN'];

CREATE OR REPLACE FUNCTION fn_crear_caja_fuerte()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte)
  VALUES (NEW.id, 'Caja Fuerte', TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crear_caja_fuerte ON tenants;
CREATE TRIGGER trg_crear_caja_fuerte
  AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION fn_crear_caja_fuerte();

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 085: OC Pagos + Cuenta Corriente Proveedores
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado_pago IN ('pendiente_pago','pago_parcial','pagada','cuenta_corriente')),
  ADD COLUMN IF NOT EXISTS monto_total DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_pago DATE,
  ADD COLUMN IF NOT EXISTS dias_plazo_pago INT,
  ADD COLUMN IF NOT EXISTS condiciones_pago TEXT;

CREATE INDEX IF NOT EXISTS idx_oc_estado_pago ON ordenes_compra(tenant_id, estado_pago);
CREATE INDEX IF NOT EXISTS idx_oc_vencimiento  ON ordenes_compra(tenant_id, fecha_vencimiento_pago)
  WHERE fecha_vencimiento_pago IS NOT NULL;

ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS cuenta_corriente_habilitada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS limite_credito_proveedor DECIMAL(12,2);

CREATE TABLE IF NOT EXISTS proveedor_cc_movimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  oc_id           UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('oc','pago','nota_credito','ajuste')),
  monto           DECIMAL(12,2) NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  medio_pago      TEXT,
  descripcion     TEXT,
  caja_sesion_id  UUID REFERENCES caja_sesiones(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pcc_tenant_proveedor ON proveedor_cc_movimientos(tenant_id, proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pcc_vencimiento ON proveedor_cc_movimientos(tenant_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;
ALTER TABLE proveedor_cc_movimientos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pcc_tenant ON proveedor_cc_movimientos FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION fn_saldo_proveedor_cc(p_proveedor_id UUID)
RETURNS DECIMAL(12,2) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(monto), 0) FROM proveedor_cc_movimientos WHERE proveedor_id = p_proveedor_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 130 — categorias_gasto + seed por tenant (v1.8.42)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias_gasto (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre             TEXT NOT NULL,
  requiere_sucursal  BOOLEAN NOT NULL DEFAULT FALSE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  predefinida        BOOLEAN NOT NULL DEFAULT FALSE,
  orden              INT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_categorias_gasto_tenant ON categorias_gasto(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categorias_gasto_activo ON categorias_gasto(tenant_id, activo) WHERE activo;
ALTER TABLE categorias_gasto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categorias_gasto_tenant" ON categorias_gasto FOR ALL
  USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE gastos        ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL;
ALTER TABLE gastos_fijos  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL;

-- Función seed_categorias_gasto + trigger AFTER INSERT en tenants para alta automática
-- (mig 166: SECURITY DEFINER — el seed corre antes de existir la fila en users durante
--  el onboarding, así que debe bypassear RLS como las otras funciones de seed del tenant)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 131 — settings de Gastos en tenants (v1.8.42)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS gastos_comp_si_iva                BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gastos_comp_si_monto              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gastos_comp_monto_umbral          DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS gastos_comp_si_deduce_ganancias   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gastos_comp_siempre               BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS gastos_dias_alerta_borrador       INT     NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS gastos_dias_alerta_anticipo_oc    INT     NOT NULL DEFAULT 15;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 132 — umbrales gasto por sucursal + autorizaciones_gasto (v1.8.43)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS umbral_gasto_supervisor DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS umbral_gasto_cajero     DECIMAL(12,2);

CREATE TABLE IF NOT EXISTS autorizaciones_gasto (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  gasto_id        UUID REFERENCES gastos(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('crear','editar','eliminar')),
  monto           DECIMAL(12,2),
  descripcion     TEXT,
  motivo          TEXT,
  payload         JSONB,
  solicitante_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  solicitante_rol TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),
  aprobador_id    UUID REFERENCES users(id),
  aprobador_rol   TEXT,
  resolved_at     TIMESTAMPTZ,
  motivo_rechazo  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autoriz_gasto_tenant_estado ON autorizaciones_gasto(tenant_id, estado);
ALTER TABLE autorizaciones_gasto ENABLE ROW LEVEL SECURITY;
CREATE POLICY autoriz_gasto_tenant ON autorizaciones_gasto FOR ALL
  USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- helper: ¿se puede aprobar esta solicitud según rol?
-- (CAJERO → SUPERVISOR+, SUPERVISOR → ADMIN/DUEÑO)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 133 — moneda del tenant + alícuota IVA + autorizaciones_cc (v1.8.44)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS'
  CHECK (moneda IN ('ARS','USD','CLP','UYU','PYG','BOB','BRL','PEN','MXN','COP','EUR'));

ALTER TABLE gastos       ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2);
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS alicuota_iva DECIMAL(5,2);

CREATE TABLE IF NOT EXISTS autorizaciones_cc (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  oc_id           UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  motivo_bloqueo  TEXT NOT NULL CHECK (motivo_bloqueo IN ('limite_excedido','oc_vencida')),
  monto           DECIMAL(12,2),
  motivo          TEXT,
  solicitante_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  solicitante_rol TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),
  aprobador_id    UUID REFERENCES users(id),
  aprobador_rol   TEXT,
  resolved_at     TIMESTAMPTZ,
  motivo_rechazo  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autoriz_cc_tenant_estado ON autorizaciones_cc(tenant_id, estado);
ALTER TABLE autorizaciones_cc ENABLE ROW LEVEL SECURITY;
CREATE POLICY autoriz_cc_tenant ON autorizaciones_cc FOR ALL
  USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 171: Relevamiento Clientes · Fase CL1 (soft delete + catálogo etiquetas)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS motivo_baja TEXT,
  ADD COLUMN IF NOT EXISTS baja_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baja_por    UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(tenant_id) WHERE activo;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cliente_etiquetas_catalogo TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 172: Relevamiento Clientes · Fase CL2 (CC clientes: límite/vencimiento/interés/morosidad)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS limite_cc_default       DECIMAL(12,2),                      -- B1/D1
  ADD COLUMN IF NOT EXISTS cc_enforcement_politica TEXT NOT NULL DEFAULT 'avisar',     -- B1: permitir|avisar|bloquear
  ADD COLUMN IF NOT EXISTS cc_morosidad_politica   TEXT NOT NULL DEFAULT 'bloqueo_cc', -- B4: permitir|bloqueo_cc|bloqueo_total
  ADD COLUMN IF NOT EXISTS cc_dias_vencimiento     INT,                                -- B3 (NULL = sin venc.)
  ADD COLUMN IF NOT EXISTS cc_interes_mensual_pct  DECIMAL(6,3) NOT NULL DEFAULT 0;    -- B3
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_cc_enforcement_chk;
ALTER TABLE tenants ADD CONSTRAINT tenants_cc_enforcement_chk CHECK (cc_enforcement_politica IN ('permitir','avisar','bloquear'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_cc_morosidad_chk;
ALTER TABLE tenants ADD CONSTRAINT tenants_cc_morosidad_chk CHECK (cc_morosidad_politica IN ('permitir','bloqueo_cc','bloqueo_total'));

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_cc DATE,                   -- B3
  ADD COLUMN IF NOT EXISTS interes_cc DECIMAL(12,2) NOT NULL DEFAULT 0; -- B3 (lo recalcula recalcular_intereses_cc)
CREATE INDEX IF NOT EXISTS idx_ventas_cc_venc ON ventas(tenant_id, fecha_vencimiento_cc) WHERE es_cuenta_corriente = TRUE;

-- RPC cliente_cc_estado(cliente) → deuda_total, deuda_vencida, interes_total (tenant-scoped, SECURITY DEFINER)
-- RPC recalcular_intereses_cc(tenant) → recalcula interes_cc de ventas CC vencidas (sweep-lazy idempotente)
-- (definiciones completas en supabase/migrations/172_clientes_cl2_cc.sql)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 173: Clientes CL3 (estado de cuenta — portal público por token)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cuenta_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_clientes_cuenta_token ON clientes(cuenta_token) WHERE cuenta_token IS NOT NULL;
-- RPC get_cuenta_cliente_by_token(token) → JSONB {cliente, negocio, moneda, ventas[]}
--   SECURITY DEFINER, GRANT anon+authenticated. Portal público /cuenta/:token (B8).
-- B6 incobrable: en app (condonación cliente + gasto "Deudores incobrables" + clave maestra + audit). Sin DDL.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 174: Fix — DROP CONSTRAINT ventas_origen_check (canal configurable desde mig 168)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_origen_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 175: Clientes CL4 (notificaciones CC + cumpleaños, config por tenant)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cc_notif_canales        TEXT[] NOT NULL DEFAULT ARRAY['whatsapp']::TEXT[], -- email|whatsapp
  ADD COLUMN IF NOT EXISTS cc_notif_registro_deuda BOOLEAN NOT NULL DEFAULT FALSE,  -- C1
  ADD COLUMN IF NOT EXISTS cc_notif_pago           BOOLEAN NOT NULL DEFAULT FALSE,  -- C4
  ADD COLUMN IF NOT EXISTS cc_notif_pre_venc_dias  INT DEFAULT 3,                   -- C2 (NULL=off)
  ADD COLUMN IF NOT EXISTS cc_notif_escalado_dias  INT,                             -- C3 (NULL=off)
  ADD COLUMN IF NOT EXISTS cumple_notif_cliente    BOOLEAN NOT NULL DEFAULT FALSE,  -- C5
  ADD COLUMN IF NOT EXISTS cumple_notif_duenio     BOOLEAN NOT NULL DEFAULT FALSE;  -- C5

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 176: Proveedores CL5 (cuentas bancarias múltiples + NC correlativo/adjunto)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedor_cuentas_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  banco TEXT, titular TEXT, cbu TEXT, alias TEXT, cuenta TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prov_cuentas_proveedor ON proveedor_cuentas_bancarias(proveedor_id);
ALTER TABLE proveedor_cuentas_bancarias ENABLE ROW LEVEL SECURITY;
-- RLS: prov_cuentas_tenant (tenant_id IN users del auth.uid)
ALTER TABLE proveedor_cc_movimientos
  ADD COLUMN IF NOT EXISTS nc_numero TEXT, ADD COLUMN IF NOT EXISTS adjunto_url TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migrations 177-180: Conteos 2.0 (ISS-CONT) — F1 scope · F2a modos/ciego/secuencia · F3 gate/reconteo · F4 ABC/cíclico/trazabilidad
-- ─────────────────────────────────────────────────────────────────────────────
-- F1 (177): scope ampliado del conteo
ALTER TABLE inventario_conteos ADD COLUMN IF NOT EXISTS filtros JSONB;  -- {marca?, categoria_id?, categoria_nombre?}
-- (inventario_conteos.tipo CHECK ampliado: ubicacion|producto|marca|categoria|sucursal)
-- F2a (178): modos + conteo a ciegas + secuencia de recorrido
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS conteo_modo TEXT NOT NULL DEFAULT 'rapido';  -- rapido|guiado|elegir
ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS secuencia INTEGER;  -- orden de recorrido (conteo + picking)
ALTER TABLE inventario_conteos ADD COLUMN IF NOT EXISTS modo TEXT NOT NULL DEFAULT 'rapido';  -- rapido|guiado
ALTER TABLE inventario_conteo_items ALTER COLUMN cantidad_contada DROP NOT NULL;  -- null=no contada, 0=contó cero
-- F3 (179): gate de ajustes + doble conteo + autorizaciones tipo ajuste_conteo
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_gate_activo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS conteo_gate_umbral_u NUMERIC, ADD COLUMN IF NOT EXISTS conteo_gate_umbral_pct NUMERIC, ADD COLUMN IF NOT EXISTS conteo_gate_umbral_valor NUMERIC,
  ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_u NUMERIC, ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_pct NUMERIC, ADD COLUMN IF NOT EXISTS conteo_reconteo_umbral_valor NUMERIC;
-- (autorizaciones_inventario.tipo CHECK ampliado: + 'ajuste_conteo')
-- F4 (180): clase ABC (auto + override) + última fecha de conteo + trazabilidad por operador + config cíclico
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS clase_abc TEXT,  -- A|B|C (CHECK), Pareto 80/95
  ADD COLUMN IF NOT EXISTS clase_abc_manual BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ultimo_conteo_at TIMESTAMPTZ;
ALTER TABLE inventario_conteo_items ADD COLUMN IF NOT EXISTS contado_por UUID REFERENCES users(id);
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_a INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_b INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS conteo_ciclico_dias_c INTEGER NOT NULL DEFAULT 180;
-- 181 (cierre F2b-ref + F3b + A2):
ALTER TABLE inventario_conteo_items
  ADD COLUMN IF NOT EXISTS fuera_de_scope BOOLEAN NOT NULL DEFAULT false,  -- F2b-ref (E3) mercadería mal ubicada
  ADD COLUMN IF NOT EXISTS costo_snapshot NUMERIC,                          -- F3b costo congelado al cargar
  ADD COLUMN IF NOT EXISTS cantidad_reconteo NUMERIC,                       -- F3b segundo conteo (doble conteo formal)
  ADD COLUMN IF NOT EXISTS reconteo_por UUID REFERENCES users(id);
ALTER TABLE inventario_conteos ADD COLUMN IF NOT EXISTS bloquea_movimientos BOOLEAN NOT NULL DEFAULT false;  -- A2 wall-to-wall
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS conteo_wall_to_wall_bloquea BOOLEAN NOT NULL DEFAULT false;     -- A2 config

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 182: Compras · CO1 (Gobierno de OC)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS oc_aprobacion_activa BOOLEAN NOT NULL DEFAULT false,  -- A2
  ADD COLUMN IF NOT EXISTS oc_aprobacion_umbral NUMERIC,
  ADD COLUMN IF NOT EXISTS oc_numeracion TEXT NOT NULL DEFAULT 'sucursal',       -- A5 (tenant|sucursal|proveedor)
  ADD COLUMN IF NOT EXISTS oc_pago_doble_firma_umbral NUMERIC;                   -- D5
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS numero_sucursal INTEGER,                              -- A5 correlativo por sucursal
  ADD COLUMN IF NOT EXISTS requiere_aprobacion BOOLEAN NOT NULL DEFAULT false,   -- A2
  ADD COLUMN IF NOT EXISTS aprobada_por UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS aprobada_at TIMESTAMPTZ;
-- set_oc_numero() actualizado: asigna numero (tenant) + numero_sucursal (por sucursal).

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 183: Compras · CO2 (Recepción robusta)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE recepcion_items ADD COLUMN IF NOT EXISTS motivo_faltante TEXT;          -- B4
ALTER TABLE recepciones     ADD COLUMN IF NOT EXISTS remito_url TEXT;               -- B7
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS over_receipt_pct_max NUMERIC,                            -- B3 umbral % over-receipt
  ADD COLUMN IF NOT EXISTS recepcion_remito_obligatorio BOOLEAN NOT NULL DEFAULT false,  -- B7
  ADD COLUMN IF NOT EXISTS recepcion_alerta_faltante_dias INTEGER NOT NULL DEFAULT 7;    -- B4
-- B5 robustez = recálculo del estado de la OC desde el acumulado de recepciones (en la app).
-- B7 bucket privado 'remitos' (path <tenant_id>/<uuid>) + policies scoped por tenant.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 184: Compras · CO3 (Costos)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compras_costo_alerta_pct NUMERIC NOT NULL DEFAULT 10;  -- E1
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS costo_aduana NUMERIC,      -- E2 accesorios sueltos
  ADD COLUMN IF NOT EXISTS costo_comision NUMERIC,
  ADD COLUMN IF NOT EXISTS costo_otros NUMERIC;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN NOT NULL DEFAULT false;    -- E3 alta en recepción
-- B6 (editar precio en recepción) = audit vía actividad_log, sin columna.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 185: Compras · CO4 (Devolución a proveedor)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devoluciones_proveedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero INTEGER, proveedor_id UUID NOT NULL REFERENCES proveedores(id),
  oc_id UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  recepcion_id UUID REFERENCES recepciones(id) ON DELETE SET NULL,
  sucursal_id UUID REFERENCES sucursales(id),
  forma TEXT NOT NULL,        -- 'credito_cc'|'efectivo'|'reposicion' (C2)
  motivo TEXT NOT NULL, observacion TEXT,  -- catálogo + libre (C3)
  monto NUMERIC NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'confirmada',
  caja_sesion_id UUID REFERENCES caja_sesiones(id), oc_reposicion_id UUID REFERENCES ordenes_compra(id),
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE devoluciones_proveedor ENABLE ROW LEVEL SECURITY;  -- policy devprov_tenant
CREATE TABLE IF NOT EXISTS devolucion_proveedor_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id UUID NOT NULL REFERENCES devoluciones_proveedor(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad NUMERIC NOT NULL, costo_unitario NUMERIC NOT NULL DEFAULT 0, lpn TEXT
);
ALTER TABLE devolucion_proveedor_items ENABLE ROW LEVEL SECURITY;  -- policy devprov_items_tenant
-- trigger set_devprov_numero (correlativo por tenant). Confirm/stock/CC/caja/reposición en la app.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 186: Compras · CO5 (Pago: anticipo + contra-entrega + schedule)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS modo_pago TEXT NOT NULL DEFAULT 'contado',  -- D1 contado|anticipo|contra_entrega|cuenta_corriente
  ADD COLUMN IF NOT EXISTS anticipo_pct NUMERIC;                       -- D1 % de anticipo del proveedor
-- CHECK proveedores_modo_pago_check (contado|anticipo|contra_entrega|cuenta_corriente).
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS paga_con_anticipo BOOLEAN NOT NULL DEFAULT false,  -- D1 la OC se paga con anticipo
  ADD COLUMN IF NOT EXISTS anticipo_pct NUMERIC,                              -- D1 snapshot del % por OC
  ADD COLUMN IF NOT EXISTS pago_schedule JSONB;                              -- D2 [{etiqueta,base,dias?,pct}]
-- D3 (transferencia con comprobante) reusa ordenes_compra.comprobante_url (ISS-096), sin columna nueva.
