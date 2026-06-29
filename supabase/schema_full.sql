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
    CHECK (rol IN ('DUEÑO','SUPER_USUARIO','SUPERVISOR','CAJERO','ADMIN','RRHH','DEPOSITO','CONTADOR','VIEWER')),
  sucursal_id    UUID,          -- mig 094: FK a sucursales(id) ON DELETE SET NULL (la FK se agrega ahí; aquí plano para evitar forward-ref)
  puede_ver_todas BOOLEAN NOT NULL DEFAULT FALSE,  -- mig 094: si false → el usuario queda restringido a sucursal_id
  nombre_display TEXT,
  activo         BOOLEAN DEFAULT TRUE,
  caja_preferida_id UUID REFERENCES cajas(id) ON DELETE SET NULL,  -- mig 239: caja predeterminada del usuario (auto-select POS/Caja/traspasos)
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

-- RLS por sucursal (mig 216). Espejan authStore.puedeVerTodas para no desincronizarse.
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

CREATE OR REPLACE FUNCTION public.auth_user_sucursal()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sucursal_id FROM users WHERE id = auth.uid()
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

-- INVENTARIO LINEAS (RLS por sucursal — mig 216)
CREATE POLICY "lineas_tenant" ON inventario_lineas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- INVENTARIO SERIES (RLS por sucursal vía línea padre — mig 218)
CREATE POLICY "series_tenant" ON inventario_series FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR linea_id IS NULL
          OR EXISTS (SELECT 1 FROM inventario_lineas l WHERE l.id = inventario_series.linea_id
                     AND ( l.sucursal_id IS NULL OR l.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- MOVIMIENTOS STOCK (append-only: solo SELECT filtra por sucursal — mig 216;
-- INSERT queda tenant-only para no romper traslados/triggers cross-sucursal)
CREATE POLICY "movimientos_select" ON movimientos_stock FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  );
CREATE POLICY "movimientos_insert" ON movimientos_stock FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ALERTAS
CREATE POLICY "alertas_tenant" ON alertas FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- CLIENTES
CREATE POLICY "clientes_tenant" ON clientes FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- VENTAS (RLS por sucursal — mig 216)
CREATE POLICY "ventas_tenant" ON ventas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- VENTA ITEMS (RLS por sucursal vía venta padre — mig 218)
CREATE POLICY "venta_items_tenant" ON venta_items FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_items.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- VENTA SERIES (RLS por sucursal vía venta padre — mig 218)
CREATE POLICY "venta_series_tenant" ON venta_series FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR venta_id IS NULL
          OR EXISTS (SELECT 1 FROM ventas v WHERE v.id = venta_series.venta_id
                     AND ( v.sucursal_id IS NULL OR v.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- CAJAS (RLS por sucursal — mig 217; bóveda/Caja Fuerte tiene sucursal_id NULL → sigue visible)
CREATE POLICY "cajas_tenant" ON cajas FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );
-- NOTA (mig 217): el mismo patrón de RLS por sucursal aplica a envios, ordenes_compra,
-- recepciones, recursos e inventario_conteos. Esas tablas no están en este snapshot
-- parcial (se agregaron por migraciones posteriores); su DDL canónico vive en
-- supabase/migrations/217_rls_sucursal_operativas.sql.

-- CAJA SESIONES (RLS por sucursal — mig 216; bóveda/Caja Fuerte tiene sucursal_id NULL → sigue visible)
CREATE POLICY "sesiones_tenant" ON caja_sesiones FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

-- CAJA MOVIMIENTOS (RLS por sucursal vía sesión padre — mig 218)
CREATE POLICY "mov_caja_tenant" ON caja_movimientos FOR ALL
  USING ( tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sesion_id IS NULL
          OR EXISTS (SELECT 1 FROM caja_sesiones s WHERE s.id = caja_movimientos.sesion_id
                     AND ( s.sucursal_id IS NULL OR s.sucursal_id = auth_user_sucursal() )) ) )
  WITH CHECK ( tenant_id = get_user_tenant_id() );
-- NOTA (mig 218): el mismo patrón hijo→padre aplica a venta_item_despachos,
-- venta_auditoria, devoluciones (SELECT), caja_arqueos, orden_compra_items,
-- recepcion_items, inventario_conteo_items y envio_items. No están en este
-- snapshot parcial; su DDL canónico vive en supabase/migrations/218_rls_sucursal_hijas.sql.

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
-- GASTOS (RLS por sucursal — mig 216)
CREATE POLICY "gastos_tenant" ON gastos
  USING (
    tenant_id = get_user_tenant_id()
    AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
  )
  WITH CHECK ( tenant_id = get_user_tenant_id() );

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

-- (def final tras mig 145 saldo-traspasos + mig 241 medio no-efectivo→egreso_informativo + mig 242 doble validación server-side)
CREATE OR REPLACE FUNCTION pagar_nomina_empleado(
  p_salario_id UUID,
  p_sesion_id  UUID,
  p_medio_pago TEXT DEFAULT 'efectivo'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sal rrhh_salarios; v_emp empleados; v_mov UUID;
  v_apertura NUMERIC; v_ingresos NUMERIC; v_egresos NUMERIC; v_saldo NUMERIC;
  v_es_efectivo boolean := (p_medio_pago = 'efectivo');
  v_concepto text; v_medio_lbl text;
  v_rol text := public.get_user_role(); v_doble boolean; v_super_ok boolean;
BEGIN
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Liquidación no encontrada'; END IF;
  IF v_sal.pagado THEN RAISE EXCEPTION 'La liquidación ya fue pagada'; END IF;
  IF v_sal.neto <= 0 THEN RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar'; END IF;
  SELECT COALESCE(rrhh_nomina_doble_validacion,false), COALESCE(rrhh_nomina_supervisor_aprueba,false)
    INTO v_doble, v_super_ok FROM tenants WHERE id = v_sal.tenant_id;
  IF v_doble AND NOT (v_rol IN ('DUEÑO','ADMIN') OR (v_super_ok AND v_rol='SUPERVISOR')) THEN
    RAISE EXCEPTION 'Requiere aprobación de DUEÑO/ADMIN (doble validación de nómina activada).' USING ERRCODE='insufficient_privilege';
  END IF;
  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;
  IF NOT EXISTS (SELECT 1 FROM caja_sesiones WHERE id = p_sesion_id AND tenant_id = v_sal.tenant_id AND estado = 'abierta') THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;
  IF v_es_efectivo THEN
    SELECT monto_apertura INTO v_apertura FROM caja_sesiones WHERE id = p_sesion_id;
    SELECT
      COALESCE(SUM(CASE WHEN tipo IN ('ingreso','ingreso_reserva','ingreso_traspaso') THEN monto ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo IN ('egreso','egreso_devolucion_sena','egreso_traspaso') THEN monto ELSE 0 END), 0)
    INTO v_ingresos, v_egresos
    FROM caja_movimientos WHERE sesion_id = p_sesion_id;
    v_saldo := COALESCE(v_apertura,0) + v_ingresos - v_egresos;
    IF v_saldo < v_sal.neto THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponible $%, necesita $%', ROUND(v_saldo), ROUND(v_sal.neto);
    END IF;
  END IF;
  v_concepto := 'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY');
  v_medio_lbl := CASE p_medio_pago WHEN 'transferencia_banco' THEN 'Transferencia'
                                   WHEN 'mp' THEN 'Mercado Pago' ELSE p_medio_pago END;
  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (v_mov, v_sal.tenant_id, p_sesion_id,
    CASE WHEN v_es_efectivo THEN 'egreso' ELSE 'egreso_informativo' END,
    CASE WHEN v_es_efectivo THEN v_concepto ELSE '[' || v_medio_lbl || '] ' || v_concepto END,
    v_sal.neto);
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

-- ─── Migration 058 + 214: Ampliar users.rol CHECK (incl. VIEWER) ──────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('DUEÑO', 'SUPER_USUARIO', 'SUPERVISOR', 'CAJERO', 'ADMIN', 'RRHH', 'DEPOSITO', 'CONTADOR', 'VIEWER'));

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
-- mig 219: SELECT/UPDATE/DELETE solo propias (aislamiento); INSERT cross-user dentro del mismo tenant
-- (el sistema avisa a supervisores/dueño de eventos generados por un cajero).
CREATE POLICY notif_select ON notificaciones FOR SELECT USING (user_id = auth.uid());
CREATE POLICY notif_update ON notificaciones FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY notif_delete ON notificaciones FOR DELETE USING (user_id = auth.uid());
CREATE POLICY notif_insert ON notificaciones FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

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
  ADD COLUMN IF NOT EXISTS recepcion_remito_obligatorio BOOLEAN NOT NULL DEFAULT false;  -- B7
  -- recepcion_alerta_faltante_dias: DROPEADA en mig 240 (columna inerte, nunca se leyó). Ídem descuento_max_cajero_pct y email_legal.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 187: Compras · CO6 (Cheques diferidos)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cheques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero_interno INTEGER,              -- correlativo por tenant (trigger set_cheque_numero)
  tipo TEXT NOT NULL DEFAULT 'propio', -- CHECK propio|tercero
  nro_cheque TEXT, banco TEXT, monto NUMERIC NOT NULL DEFAULT 0,
  fecha_emision DATE, fecha_cobro DATE,
  estado TEXT NOT NULL DEFAULT 'en_cartera', -- CHECK en_cartera|entregado|depositado|cobrado|endosado|rechazado|anulado
  proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  endosado_a_proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  cliente_origen TEXT, oc_id UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  sucursal_id UUID REFERENCES sucursales(id), notas TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;  -- policy cheques_tenant + CHECKs tipo/estado + trigger correlativo
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cheques_alerta_dias INTEGER NOT NULL DEFAULT 7;  -- CO6 alerta

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 188: Compras · CO7b (Servicios: recurrentes F1 + catálogo genérico F2)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE servicio_items
  ADD COLUMN IF NOT EXISTS recurrente BOOLEAN NOT NULL DEFAULT false,  -- F1
  ADD COLUMN IF NOT EXISTS frecuencia TEXT,                            -- F1 mensual|bimestral|trimestral|semestral|anual
  ADD COLUMN IF NOT EXISTS proximo_vencimiento DATE,                   -- F1 sweep lazy genera gasto
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE servicio_items ALTER COLUMN proveedor_id DROP NOT NULL;    -- F2 servicios genéricos del tenant
-- F3 (comparar presupuestos) = vista en la app sobre servicio_presupuestos, sin cambios de schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 189: Envíos · EN1 (Pagos a courier contables + conciliación, C1-C4)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE envios ADD COLUMN IF NOT EXISTS gasto_id           UUID REFERENCES gastos(id) ON DELETE SET NULL;  -- C2 link al gasto generado
ALTER TABLE envios ADD COLUMN IF NOT EXISTS courier_factura_id UUID;  -- C3 FK lógica a courier_facturas
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_courier_genera_gasto    BOOLEAN NOT NULL DEFAULT TRUE;  -- C2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_courier_iva_pct         NUMERIC NOT NULL DEFAULT 21;    -- C2 alícuota IVA flete
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_pago_doble_firma_umbral NUMERIC NOT NULL DEFAULT 0;     -- C4 (0 = sin doble firma)
-- courier_facturas (C3): factura del courier por período; conciliación contra envíos registrados
CREATE TABLE IF NOT EXISTS courier_facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  courier TEXT NOT NULL, nro_factura TEXT,
  periodo_desde DATE, periodo_hasta DATE,
  total_facturado NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_registrado NUMERIC(12,2) NOT NULL DEFAULT 0,
  diferencia NUMERIC(12,2) NOT NULL DEFAULT 0,  -- facturado - registrado
  archivo_url TEXT, estado TEXT NOT NULL DEFAULT 'borrador',  -- borrador|conciliada
  notas TEXT, sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE courier_facturas ENABLE ROW LEVEL SECURITY;  -- policy courier_facturas_tenant
-- courier_factura_lineas (C3): match por envío (registrado vs facturado)
CREATE TABLE IF NOT EXISTS courier_factura_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  factura_id UUID NOT NULL REFERENCES courier_facturas(id) ON DELETE CASCADE,
  envio_id UUID REFERENCES envios(id) ON DELETE SET NULL,
  monto_registrado NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_facturado NUMERIC(12,2), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE courier_factura_lineas ENABLE ROW LEVEL SECURITY;  -- policy courier_factura_lineas_tenant

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 190: Envíos · EN2 (POD robusto + cierre de entrega, D1-D6)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_firma_url TEXT;          -- D3 firma del receptor (canvas → storage)
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_dni TEXT;                -- D3 DNI del receptor
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_lat NUMERIC;            -- D4 geoloc al entregar
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_lon NUMERIC;            -- D4
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_geo_estado TEXT;        -- D4 ok|fuera_rango|no_disponible
ALTER TABLE envios ADD COLUMN IF NOT EXISTS pod_otp_verificado BOOLEAN NOT NULL DEFAULT FALSE; -- D3
ALTER TABLE envios ADD COLUMN IF NOT EXISTS intentos INT NOT NULL DEFAULT 0;          -- D6
ALTER TABLE envios ADD COLUMN IF NOT EXISTS reintento_motivo TEXT;      -- D6
ALTER TABLE envios ADD COLUMN IF NOT EXISTS subestado_no_entrega TEXT;  -- D5 ausente|rechazado|direccion_incorrecta
ALTER TABLE envios ADD COLUMN IF NOT EXISTS no_entrega_motivo TEXT;     -- D5
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_campos_requeridos JSONB NOT NULL DEFAULT '{"fecha":true,"receptor":true,"foto":false,"firma":false,"dni":false}'::jsonb; -- D1
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_foto_min INT NOT NULL DEFAULT 0;            -- D2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_otp_umbral NUMERIC NOT NULL DEFAULT 0;      -- D3 (0 = off)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_geoloc_alerta_km NUMERIC NOT NULL DEFAULT 0; -- D4 (0 = off)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_reintentos_max INT NOT NULL DEFAULT 3;    -- D6
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_reintento_recargo NUMERIC NOT NULL DEFAULT 0; -- D6
-- envio_otp (D3): código de un solo uso para validar la entrega (envío propio sobre umbral)
CREATE TABLE IF NOT EXISTS envio_otp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL, telefono TEXT,
  enviado_at TIMESTAMPTZ DEFAULT NOW(), verificado_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE envio_otp ENABLE ROW LEVEL SECURITY;  -- policy envio_otp_tenant
-- RPCs públicas del transportista ampliadas: get_envio_by_token (devuelve config POD + es_propio),
-- update_envio_by_token (firma/DNI/geoloc/sub-estado/reintento), generar_otp_envio, verificar_otp_envio.
-- Todas SECURITY DEFINER, GRANT a anon + authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 191: Envíos · EN3 (Reparto: repartidores + hoja de ruta + transportista)
-- ─────────────────────────────────────────────────────────────────────────────
-- repartidores (G1): catálogo de repartidores del envío propio (vinculables a empleados)
CREATE TABLE IF NOT EXISTS repartidores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL, empleado_id UUID REFERENCES empleados(id) ON DELETE SET NULL,
  telefono TEXT, vehiculo TEXT, activo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE repartidores ENABLE ROW LEVEL SECURITY;  -- policy repartidores_tenant
ALTER TABLE envios ADD COLUMN IF NOT EXISTS repartidor_id UUID REFERENCES repartidores(id) ON DELETE SET NULL; -- G1
ALTER TABLE envios ADD COLUMN IF NOT EXISTS token_expira_at TIMESTAMPTZ;  -- E1
ALTER TABLE envios ADD COLUMN IF NOT EXISTS hoja_ruta_id UUID;            -- E3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_token_politica  TEXT NOT NULL DEFAULT 'al_entregar'; -- E1 al_entregar|dias
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_token_dias      INT  NOT NULL DEFAULT 30;            -- E1
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_identidad_modo  TEXT NOT NULL DEFAULT 'anonimo';     -- E4 anonimo|nombre_dni
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_notif_en_camino TEXT NOT NULL DEFAULT 'wa';          -- E5 no|wa|wa_tracking
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_hoja_ruta_modo  TEXT NOT NULL DEFAULT 'agrupada';    -- E3 por_envio|agrupada|agrupada_proximidad
-- hojas_ruta + hoja_ruta_envios (E3/G3): hoja agrupada por chofer con token público
CREATE TABLE IF NOT EXISTS hojas_ruta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE, repartidor_id UUID REFERENCES repartidores(id) ON DELETE SET NULL,
  token TEXT UNIQUE, sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE hojas_ruta ENABLE ROW LEVEL SECURITY;  -- policy hojas_ruta_tenant
CREATE TABLE IF NOT EXISTS hoja_ruta_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hoja_id UUID NOT NULL REFERENCES hojas_ruta(id) ON DELETE CASCADE,
  envio_id UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE, orden INT NOT NULL DEFAULT 0
);
ALTER TABLE hoja_ruta_envios ENABLE ROW LEVEL SECURITY;  -- policy hoja_ruta_envios_tenant
-- envio_incidencias (E2): incidencias reportadas por el transportista
CREATE TABLE IF NOT EXISTS envio_incidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE, tipo TEXT NOT NULL, detalle TEXT,
  reportado_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE envio_incidencias ENABLE ROW LEVEL SECURITY;  -- policy envio_incidencias_tenant
-- RPCs públicas: get_envio_by_token (agrega repartidor/identidad + chequea token_expira_at),
-- reportar_incidencia_envio, get_hoja_ruta_by_token. Todas SECURITY DEFINER, GRANT anon+authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 192: Envíos · EN4 (Costos y tarifas avanzados, B1-B6)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_factor_km        NUMERIC NOT NULL DEFAULT 1.35; -- B2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_costo_minimo     NUMERIC NOT NULL DEFAULT 0;    -- B3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_tramos           JSONB   NOT NULL DEFAULT '[]'::jsonb;  -- B3 [{hasta,precio}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_recargo_horario  JSONB   NOT NULL DEFAULT '[]'::jsonb;  -- B1 [{desde,hasta,recargo}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_cobro_politica   TEXT    NOT NULL DEFAULT 'cliente_100'; -- B4 cliente_100|cliente_margen|subsidio
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_cobro_margen_pct NUMERIC NOT NULL DEFAULT 0;    -- B4
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_subsidio_umbral  NUMERIC NOT NULL DEFAULT 0;    -- B4
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_gratis_reglas    JSONB   NOT NULL DEFAULT '{}'::jsonb;   -- B5 {montoMinimo,etiquetas,promoDesde,promoHasta}
-- B6 — diferencia real vs cotizado (precio al cliente inmutable post-pago)
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_tipo   TEXT;     -- a_favor|perdida|neutro
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_monto  NUMERIC;
ALTER TABLE envios ADD COLUMN IF NOT EXISTS diferencia_motivo TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 193: Envíos · EN5 (Creación y alcance, A1-A5)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE envios ADD COLUMN IF NOT EXISTS tipo               TEXT NOT NULL DEFAULT 'venta'; -- A2 venta|traslado_interno|muestra|dev_proveedor|otro
ALTER TABLE envios ADD COLUMN IF NOT EXISTS motivo             TEXT;                           -- A2
ALTER TABLE envios ADD COLUMN IF NOT EXISTS sucursal_destino_id UUID REFERENCES sucursales(id) ON DELETE SET NULL; -- A2 traslado interno
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cp_courier_preferido JSONB NOT NULL DEFAULT '[]'::jsonb;  -- A3 [{desde,hasta,courier}]
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_plazo_despacho JSONB NOT NULL DEFAULT '{}'::jsonb;  -- A4 {presencial,online,mayorista} horas
-- envio_items (A5): desglose de qué se despachó en cada envío (split de una venta en varios envíos)
CREATE TABLE IF NOT EXISTS envio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envio_id UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE, producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  cantidad NUMERIC NOT NULL DEFAULT 0, lpn TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE envio_items ENABLE ROW LEVEL SECURITY;  -- policy envio_items_tenant
-- A1 (DEPOSITO crea envíos) = solo permiso de UI (AppLayout depositoVisible + DEPOSITO_ALLOWED), sin DDL.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 194: Envíos · EN7 (Envío propio + recursos + reportes/alertas, G2 + H1/H2/H3)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE envios ADD COLUMN IF NOT EXISTS recurso_id           UUID REFERENCES recursos(id) ON DELETE SET NULL; -- G2 vehículo
ALTER TABLE envios ADD COLUMN IF NOT EXISTS km_recorridos        NUMERIC;                                          -- G2
ALTER TABLE envios ADD COLUMN IF NOT EXISTS gasto_combustible_id UUID REFERENCES gastos(id) ON DELETE SET NULL;   -- G2
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS km_acumulado         NUMERIC NOT NULL DEFAULT 0;  -- G2 odómetro
ALTER TABLE recursos ADD COLUMN IF NOT EXISTS consumo_litros_100km NUMERIC;                     -- G2 rendimiento L/100km
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_combustible_precio_litro NUMERIC NOT NULL DEFAULT 0;  -- G2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_sin_despacho_horas INT NOT NULL DEFAULT 24;    -- H2-a
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_pod_pendiente_dias INT NOT NULL DEFAULT 3;     -- H2-b
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_pago_courier_dias  INT NOT NULL DEFAULT 7;     -- H2-c
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS envio_alerta_diferencia_pct     NUMERIC NOT NULL DEFAULT 15; -- H2-d
-- Categoría de gasto "Combustible" (predefinida, mig 130 orden 90) garantizada para tenants viejos (idempotente).
-- H1/H3 (reportes + export Excel/PDF/CSV + etiquetas A4 con QR) son solo frontend, sin DDL.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 195-198: RRHH RH1+RH2+RH3+RH6 (v1.46.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- RH1 (mig 195) — Empleados 2.0
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_egreso TEXT;       -- A2
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cbu TEXT;                 -- A4
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS alias_cbu TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS banco TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tipo_cuenta TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS titular_cuenta TEXT;
ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_tipo_contrato_check;  -- A3 (catálogo configurable)
CREATE TABLE IF NOT EXISTS rrhh_tipos_contrato (  -- A3
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL, es_relacion_dependencia BOOLEAN NOT NULL DEFAULT TRUE, activo BOOLEAN NOT NULL DEFAULT TRUE,
  predefinido BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, nombre)
);
ALTER TABLE rrhh_tipos_contrato ENABLE ROW LEVEL SECURITY;  -- policy rrhh_tipos_contrato_tenant + seed base AR
-- RH2 (mig 196) — Conceptos + aportes AR + SAC
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS pais TEXT;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS predefinido BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS tipo_calculo TEXT NOT NULL DEFAULT 'fijo';  -- fijo|porcentaje|sobre_bruto
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS default_pct NUMERIC;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS default_monto NUMERIC;
ALTER TABLE rrhh_conceptos ADD COLUMN IF NOT EXISTS es_aporte BOOLEAN NOT NULL DEFAULT FALSE;  -- B4 toggleable por empleado
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS config_aportes JSONB NOT NULL DEFAULT '[]'::jsonb;   -- B4 concepto_id activos
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS beneficios_extra JSONB NOT NULL DEFAULT '[]'::jsonb; -- B4
-- (seed catálogo AR: Antigüedad/Presentismo/Jubilación 11%/Obra Social 3%/Ley 19.032 3%/Sindicato, idempotente)
-- RH3 (mig 197) — Nómina contable + recibo + Gastos
ALTER TABLE rrhh_salarios ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;  -- B7
ALTER TABLE rrhh_salarios ADD COLUMN IF NOT EXISTS comprobante_firmado_url TEXT;  -- B6
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_nomina_doble_validacion BOOLEAN NOT NULL DEFAULT FALSE;   -- B8
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_nomina_supervisor_aprueba BOOLEAN NOT NULL DEFAULT FALSE; -- B8
-- (categorías de gasto "Sueldos" + "Cargas sociales" predefinidas, idempotente)
-- RH6 (mig 198) — Asistencia 2.0
CREATE TABLE IF NOT EXISTS rrhh_fichadas (  -- D1
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE, sucursal_id UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida')), ts TIMESTAMPTZ NOT NULL DEFAULT NOW(), origen TEXT NOT NULL DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_fichadas ENABLE ROW LEVEL SECURITY;  -- policy rrhh_fichadas_tenant
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS horario_entrada TIME;  -- D2
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS horario_salida TIME;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS dias_laborales JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb;
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS tipo_licencia TEXT;    -- D4
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS comprobante_url TEXT;  -- D4
ALTER TABLE rrhh_asistencia ADD COLUMN IF NOT EXISTS minutos_tarde INT;     -- D3
CREATE TABLE IF NOT EXISTS rrhh_horas_extra (  -- D5
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE, fecha DATE NOT NULL, horas NUMERIC NOT NULL DEFAULT 0,
  multiplicador INT NOT NULL DEFAULT 50, aprobada BOOLEAN NOT NULL DEFAULT FALSE, aprobada_por UUID REFERENCES users(id) ON DELETE SET NULL, notas TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_horas_extra ENABLE ROW LEVEL SECURITY;  -- policy rrhh_horas_extra_tenant
ALTER TABLE rrhh_feriados ADD COLUMN IF NOT EXISTS regla_pago TEXT NOT NULL DEFAULT 'doble';  -- D6
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_tardanza_modo TEXT NOT NULL DEFAULT 'registrar';  -- D3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_tardanza_tolerancia_min INT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_horas_extra_requiere_aprobacion BOOLEAN NOT NULL DEFAULT TRUE;  -- D5
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_horas_mes_base INT NOT NULL DEFAULT 200;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 199-200: RRHH RH4+RH5 (v1.47.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- RH4 (mig 199) — Frecuencia de liquidación + anticipos
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS frecuencia_liquidacion TEXT NOT NULL DEFAULT 'mensual';  -- B1 mensual|quincenal|semanal|personalizado
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS frecuencia_dias INT;  -- B1 (personalizado)
CREATE TABLE IF NOT EXISTS rrhh_anticipos (  -- B10
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE, monto NUMERIC NOT NULL DEFAULT 0, fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo TEXT, gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL, descontado_en_salario_id UUID REFERENCES rrhh_salarios(id) ON DELETE SET NULL,
  saldado BOOLEAN NOT NULL DEFAULT FALSE, created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_anticipos ENABLE ROW LEVEL SECURITY;  -- policy rrhh_anticipos_tenant
-- (categoría de gasto "Adelantos al personal" predefinida, idempotente)
-- RH5 (mig 200) — Vacaciones 2.0
ALTER TABLE rrhh_vacaciones_solicitud DROP CONSTRAINT IF EXISTS rrhh_vacaciones_solicitud_estado_check;  -- C2 (estados validados en app: pendiente|preaprobada|aprobada|rechazada)
ALTER TABLE rrhh_vacaciones_solicitud ADD COLUMN IF NOT EXISTS preaprobado_por UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE rrhh_vacaciones_solicitud ADD COLUMN IF NOT EXISTS preaprobado_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_flujo JSONB NOT NULL DEFAULT '{"supervisor":"preaprueba","rrhh":"aprueba"}'::jsonb;  -- C2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_aviso JSONB NOT NULL DEFAULT '{"modo":"alerta","dias":30}'::jsonb;  -- C3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_remanente_max INT NOT NULL DEFAULT 0;  -- C6
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_min_bloque INT NOT NULL DEFAULT 0;  -- C5
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_vacaciones_max_bloques INT NOT NULL DEFAULT 0;  -- C5

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 201-202: RRHH RH7+RH8 (v1.48.0) — RRHH 2.0 COMPLETO
-- ─────────────────────────────────────────────────────────────────────────────
-- RH7 (mig 201) — documentos obligatorios + vencimiento + capacitación obligatoria + evaluación + portal/notif
CREATE TABLE IF NOT EXISTS rrhh_documentos_catalogo (  -- E1
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL, obligatorio BOOLEAN NOT NULL DEFAULT TRUE, activo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, nombre)
);
ALTER TABLE rrhh_documentos_catalogo ENABLE ROW LEVEL SECURITY;  -- policy rrhh_doc_catalogo_tenant
ALTER TABLE rrhh_documentos ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;  -- E2
ALTER TABLE rrhh_documentos ADD COLUMN IF NOT EXISTS catalogo_id UUID REFERENCES rrhh_documentos_catalogo(id) ON DELETE SET NULL;
ALTER TABLE rrhh_capacitaciones ADD COLUMN IF NOT EXISTS obligatoria BOOLEAN NOT NULL DEFAULT FALSE;  -- E3
CREATE TABLE IF NOT EXISTS rrhh_evaluaciones (  -- F4
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE, periodo TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'supervisor',
  evaluador_id UUID REFERENCES users(id) ON DELETE SET NULL, puntaje INT, comentarios TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_evaluaciones ENABLE ROW LEVEL SECURITY;  -- policy rrhh_evaluaciones_tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_portal_empleado BOOLEAN NOT NULL DEFAULT FALSE;  -- F2
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_portal_capacidades JSONB NOT NULL DEFAULT '{"vacaciones":true,"recibos":true,"documentos":false,"firma":false}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_notif_config JSONB NOT NULL DEFAULT '{"cumpleanos":true,"aniversario":true,"vacaciones_proximas":true,"doc_vencer":true,"contrato_vencer":true}'::jsonb;  -- F3
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rrhh_doc_alerta_dias INT NOT NULL DEFAULT 30;  -- E2
-- RH8 (mig 202) — liquidación final (A2-c). G1 reportes + G2 export = solo frontend.
CREATE TABLE IF NOT EXISTS rrhh_liquidaciones_finales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE, fecha_egreso DATE, motivo_egreso TEXT,
  antiguedad_anios INT, mejor_sueldo NUMERIC, indemnizacion NUMERIC NOT NULL DEFAULT 0, sac_proporcional NUMERIC NOT NULL DEFAULT 0,
  vacaciones_no_gozadas NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0, gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL,
  notas TEXT, created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rrhh_liquidaciones_finales ENABLE ROW LEVEL SECURITY;  -- policy rrhh_liq_finales_tenant

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 203: Caja — cierre del relevamiento (v1.50.0) — E3 arqueo bóveda · L3 préstamo
-- ─────────────────────────────────────────────────────────────────────────────
-- E3 — arqueo manual de bóveda (sin cerrarla). RLS estricta solo DUEÑO/ADMIN/SUPER_USUARIO.
CREATE TABLE IF NOT EXISTS boveda_arqueos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuenta_origen_id UUID REFERENCES cuentas_origen(id) ON DELETE SET NULL,
  saldo_sistema DECIMAL(14,2) NOT NULL DEFAULT 0, saldo_contado DECIMAL(14,2) NOT NULL DEFAULT 0,
  diferencia DECIMAL(14,2) NOT NULL DEFAULT 0, notas TEXT,
  usuario_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE boveda_arqueos ENABLE ROW LEVEL SECURITY;  -- policy boveda_arqueos_solo_dueno (DUEÑO/ADMIN/SUPER_USUARIO)
-- L3 — préstamo a empleado: flag + nota firmada adjunta (reusa rrhh_anticipos)
ALTER TABLE rrhh_anticipos ADD COLUMN IF NOT EXISTS es_prestamo BOOLEAN NOT NULL DEFAULT FALSE;  -- L3
ALTER TABLE rrhh_anticipos ADD COLUMN IF NOT EXISTS documento_url TEXT;  -- L3 (bucket empleados)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 204: RRHH — fichado por QR público (v1.51.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Token público de fichado por tenant + RPCs SECURITY DEFINER anon (get_fichado_info / fichar_qr).
-- Auto-descuento de tardanza (en crearLiquidacion) y portal del empleado (/mi-portal) = solo frontend,
-- usan columnas/config ya existentes (rrhh_tardanza_*, rrhh_horas_mes_base, rrhh_portal_*).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fichado_token TEXT;  -- RH6: QR de fichado /fichar/:token
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_fichado_token ON tenants(fichado_token) WHERE fichado_token IS NOT NULL;
-- + funciones get_fichado_info(text) / fichar_qr(text,uuid) SECURITY DEFINER, GRANT EXECUTE a anon (ver mig 204).

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 205: Traslados de stock entre sucursales (v1.53.0 — auditoría de procesos #4)
-- ─────────────────────────────────────────────────────────────────────────────
-- Proceso formal con tránsito: despachar (origen, DEPOSITO+) → stock sale, "en_transito"
-- → confirmar recepción (destino) → stock entra (mismo LPN/lote/series); parciales auditados.
CREATE TABLE IF NOT EXISTS traslados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero INTEGER,  -- correlativo por tenant (trigger set_traslado_numero)
  sucursal_origen_id UUID NOT NULL REFERENCES sucursales(id), sucursal_destino_id UUID NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL DEFAULT 'en_transito' CHECK (estado IN ('en_transito','recibido','recibido_parcial','cancelado')),
  notas TEXT, envio_id UUID REFERENCES envios(id) ON DELETE SET NULL,
  despachado_por UUID REFERENCES users(id), despachado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recibido_por UUID REFERENCES users(id), recibido_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sucursal_origen_id <> sucursal_destino_id)
);
ALTER TABLE traslados ENABLE ROW LEVEL SECURITY;  -- policy traslados_tenant (por tenant)
CREATE TABLE IF NOT EXISTS traslado_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  traslado_id UUID NOT NULL REFERENCES traslados(id) ON DELETE CASCADE, producto_id UUID NOT NULL REFERENCES productos(id),
  linea_origen_id UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,
  linea_destino_id UUID REFERENCES inventario_lineas(id) ON DELETE SET NULL,  -- creada al recibir
  lpn TEXT, nro_lote TEXT, fecha_vencimiento DATE, estado_id UUID REFERENCES estados_inventario(id),
  precio_costo_snapshot DECIMAL(14,2), series JSONB,  -- [{serie_id, nro_serie}]
  cantidad DECIMAL(14,4) NOT NULL CHECK (cantidad > 0), cantidad_recibida DECIMAL(14,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE traslado_items ENABLE ROW LEVEL SECURITY;  -- policy traslado_items_tenant (por tenant)
-- + función/trigger set_traslado_numero (correlativo por tenant, patrón mig 185)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 206: Cheques conectados al circuito de pago (v1.54.0 — auditoría #5)
-- ─────────────────────────────────────────────────────────────────────────────
-- Pagar OC/gasto con medio "Cheque" crea el cheque vinculado; cheque propio
-- RECHAZADO revierte el pago (OC/gasto a pendiente + ajuste en CC proveedor).
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS gasto_id UUID REFERENCES gastos(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 207: Modo de operación por tenant — Básico vs Avanzado (WMS)
-- ─────────────────────────────────────────────────────────────────────────────
-- 'basico' = experiencia simplificada (kiosco/pyme chica), solo capa de presentación;
-- 'avanzado' = sistema completo (gateado a Pro+ en el front). Existentes → 'avanzado'.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modo_operacion TEXT NOT NULL DEFAULT 'basico'
  CHECK (modo_operacion IN ('basico', 'avanzado'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 231: reconciliar drift DEV↔PROD de columnas/objetos (PAR-03/PAR-04)
-- ─────────────────────────────────────────────────────────────────────────────
-- Detectado por la auditoría de paridad del UAT de primer uso. Estas 3 columnas existían
-- en DEV (con datos y usadas por la app) pero NO en PROD por DDL fuera de banda → rompían
-- en PROD (alta de clientes, venta con costo de envío + PDF de factura, movimiento de stock).
-- NOTA: schema_full quedó desactualizado entre la mig 208 y la 230 (mantenimiento lapsado);
-- estas columnas en particular ni siquiera tenían migración versionada antes de la 231.
ALTER TABLE ventas            ADD COLUMN IF NOT EXISTS costo_envio NUMERIC;                          -- fiscal: envío cobrado (v1.78.0)
ALTER TABLE movimientos_stock ADD COLUMN IF NOT EXISTS linea_id UUID REFERENCES inventario_lineas(id); -- trazabilidad WMS
ALTER TABLE clientes          ADD COLUMN IF NOT EXISTS notas TEXT;                                   -- notas del cliente
-- + autorizaciones_inventario.linea_id → nullable (alinea con mig 103; DEV había quedado NOT NULL)
-- + event trigger ensure_rls / fn rls_auto_enable (auto-habilita RLS en tablas nuevas de public) — paridad

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 232: FIX regresión del seed — restaurar Sucursal 1 + Caja Principal + unidades
-- ─────────────────────────────────────────────────────────────────────────────
-- La mig 225 reescribió fn_seed_tenant_defaults para agregar Efectivo + métodos y PERDIÓ la
-- creación de Sucursal 1 + Caja Principal + 6 unidades de medida que tenían las migs 114/148.
-- Desde 2026-06-18 los tenants nuevos nacían sin sucursal/caja/unidades → no podían operar.
-- mig 232 restaura el set COMPLETO en fn_seed_tenant_defaults + backfillea tenants afectados.
-- (Detectado validando un alta desde cero; afectaba a "El muller" en PROD.)

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 233: clave maestra HASHEADA (bcrypt) + setter server-side (v1.80.2)
-- ─────────────────────────────────────────────────────────────────────────────
-- tenants.clave_maestra pasa de texto plano a bcrypt (extensions.crypt/gen_salt('bf')).
-- verificar_clave_maestra(tenant, clave) compara contra el hash (NULL/vacía → TRUE = sin clave).
-- Nuevo set_clave_maestra(p_clave) SECURITY DEFINER: solo DUEÑO, mínimo 6 chars, hashea server-side.

-- ─────────────────────────────────────────────────────────────────────────────
-- Migrations 234-238: guards server-side de PLATA (v1.81.0, REGLA #0 — cierra H1/H2 de uat-app.md)
-- ─────────────────────────────────────────────────────────────────────────────
-- El enforcement de los controles financieros vivía solo en el frontend (bypasseable). Estos guards
-- lo mueven al servidor (defense-in-depth + atomicidad). Ver SQL completo en supabase/migrations/.
--   234 fn_ventas_cc_guard()            — BEFORE INSERT ventas: límite CC (política 'bloquear') +
--                                          morosidad ('bloqueo_total'/'bloqueo_cc'); deuda computada
--                                          INLINE scopeada por NEW.tenant_id (no vía cliente_cc_estado,
--                                          que filtra por auth.uid()→0 sin sesión). trg_ventas_cc_guard.
--   235 fn_ventas_writeoff_rol_guard()  — BEFORE UPDATE ventas: exige rol DUEÑO/SUPERVISOR/SUPER_USUARIO/
--                                          ADMIN al agregar tag nuevo 'Condonación CC'/'Incobrable'.
--   236 marcar_incobrable(cliente,clave,motivo) RETURNS jsonb — SECURITY DEFINER: rol (DUEÑO/SUPER_USUARIO/
--                                          ADMIN) + verificar_clave_maestra server-side + write-off atómico
--                                          (condona toda la deuda CC + gasto "Deudor incobrable").
--   237 registrar_pago_oc(oc,medios,descuento,clave,caja,cheque,dias,condiciones) RETURNS jsonb —
--                                          SECURITY DEFINER: rol (no CONTADOR) + doble firma server-side
--                                          sobre oc_pago_doble_firma_umbral (BLOQUEA si supera el umbral
--                                          y no hay clave configurada) + saldo; escribe OC + proveedor_cc
--                                          + cheque + caja_movimientos en una transacción.
--   238 marcar_envios_pagados(envio_ids,clave,medio,fecha,caja,genera_gasto,iva_pct,categoria) RETURNS jsonb —
--                                          SECURITY DEFINER: doble firma server-side; agrupa por courier,
--                                          gasto con desglose de IVA + caja + marca envíos pagados, atómico.
-- Todas REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated. DEV + PROD ✅ (PR #236).

-- ── 246 — Cash-out de saldo a favor (cliente_creditos) en efectivo ─────────────
-- devolver_saldo_a_favor(p_cliente_id, p_monto, p_sesion_id, p_nota) SECURITY INVOKER:
-- atómico + guards server-side (monto ≤ saldo a favor SUM, sesión abierta+tenant, no caja
-- negativa CAJ-18); asienta egreso de efectivo en caja + cliente_creditos negativo (origen
-- 'retiro_efectivo'). REVOKE FROM PUBLIC + GRANT authenticated/service_role. (mig 246, v1.96.0)
