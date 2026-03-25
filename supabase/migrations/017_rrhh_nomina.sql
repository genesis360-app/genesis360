-- ============================================================
-- Migration 017: RRHH Phase 2A — Nómina
-- Tablas: rrhh_conceptos · rrhh_salarios · rrhh_salario_items
-- Funciones: fn_recalcular_salario · pagar_nomina_empleado
-- ============================================================

-- ─── rrhh_conceptos: catálogo de conceptos salariales reutilizables ──────────
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_conceptos' AND policyname='rrhh_conceptos_tenant') THEN
    CREATE POLICY "rrhh_conceptos_tenant" ON rrhh_conceptos
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── rrhh_salarios: liquidación por empleado × periodo (mes) ─────────────────
CREATE TABLE IF NOT EXISTS rrhh_salarios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empleado_id        UUID NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
  periodo            DATE NOT NULL,          -- siempre YYYY-MM-01
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_salarios' AND policyname='rrhh_salarios_tenant') THEN
    CREATE POLICY "rrhh_salarios_tenant" ON rrhh_salarios
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── rrhh_salario_items: líneas de detalle de cada liquidación ───────────────
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rrhh_salario_items' AND policyname='rrhh_salario_items_tenant') THEN
    CREATE POLICY "rrhh_salario_items_tenant" ON rrhh_salario_items
      USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── updated_at trigger (reutiliza función si ya existe) ─────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_conceptos_updated_at' AND event_object_table = 'rrhh_conceptos'
  ) THEN
    CREATE TRIGGER trg_conceptos_updated_at
      BEFORE UPDATE ON rrhh_conceptos
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_salarios_updated_at' AND event_object_table = 'rrhh_salarios'
  ) THEN
    CREATE TRIGGER trg_salarios_updated_at
      BEFORE UPDATE ON rrhh_salarios
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ─── Trigger: recalcular totales en rrhh_salarios tras cambios en items ───────
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
  FROM rrhh_salario_items
  WHERE salario_id = v_id;

  UPDATE rrhh_salarios SET
    total_haberes    = v_hab,
    total_descuentos = v_des,
    neto             = v_hab - v_des,
    updated_at       = NOW()
  WHERE id = v_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_recalcular_salario' AND event_object_table = 'rrhh_salario_items'
  ) THEN
    CREATE TRIGGER trg_recalcular_salario
      AFTER INSERT OR UPDATE OR DELETE ON rrhh_salario_items
      FOR EACH ROW EXECUTE FUNCTION fn_recalcular_salario();
  END IF;
END $$;

-- ─── pagar_nomina_empleado ───────────────────────────────────────────────────
-- Valida sesión de caja, crea egreso, marca la liquidación como pagada.
-- Retorna el id del caja_movimiento creado.
CREATE OR REPLACE FUNCTION pagar_nomina_empleado(
  p_salario_id UUID,
  p_sesion_id  UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sal rrhh_salarios;
  v_emp empleados;
  v_mov UUID;
BEGIN
  -- Obtener liquidación
  SELECT * INTO v_sal FROM rrhh_salarios WHERE id = p_salario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liquidación no encontrada';
  END IF;
  IF v_sal.pagado THEN
    RAISE EXCEPTION 'La liquidación ya fue pagada';
  END IF;
  IF v_sal.neto <= 0 THEN
    RAISE EXCEPTION 'El neto debe ser mayor a 0 para poder pagar';
  END IF;

  -- Obtener empleado
  SELECT * INTO v_emp FROM empleados WHERE id = v_sal.empleado_id;

  -- Validar sesión de caja abierta y del mismo tenant
  IF NOT EXISTS (
    SELECT 1 FROM caja_sesiones
    WHERE id        = p_sesion_id
      AND tenant_id = v_sal.tenant_id
      AND estado    = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta o no pertenece al negocio';
  END IF;

  -- Crear movimiento de egreso en caja
  v_mov := gen_random_uuid();
  INSERT INTO caja_movimientos(id, tenant_id, sesion_id, tipo, concepto, monto)
  VALUES (
    v_mov,
    v_sal.tenant_id,
    p_sesion_id,
    'egreso',
    'Nómina ' || v_emp.dni_rut || ' - ' || TO_CHAR(v_sal.periodo, 'MM/YYYY'),
    v_sal.neto
  );

  -- Marcar liquidación como pagada
  UPDATE rrhh_salarios SET
    pagado             = TRUE,
    fecha_pago         = NOW(),
    caja_movimiento_id = v_mov,
    updated_at         = NOW()
  WHERE id = p_salario_id;

  RETURN v_mov;
END;
$$;
