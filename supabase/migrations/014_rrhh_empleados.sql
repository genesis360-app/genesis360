-- ============================================================
-- 014_rrhh_empleados.sql
-- Module RRHH Phase 1: Gestión básica de empleados, puestos, departamentos
-- ============================================================

-- 1. Helper function para validar que usuario es RRHH o OWNER
-- Reutiliza patrón is_admin()
CREATE OR REPLACE FUNCTION public.is_rrhh()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND (rol = 'RRHH' OR rol = 'OWNER')
  )
$$;

-- ============================================================
-- 2. DEPARTAMENTOS
-- ============================================================
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

-- ============================================================
-- 3. PUESTOS
-- ============================================================
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

-- ============================================================
-- 4. EMPLEADOS
-- Tabla principal de gestión RRHH
-- ============================================================
CREATE TABLE IF NOT EXISTS empleados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Documento
  dni_rut         TEXT NOT NULL,
  tipo_doc        TEXT CHECK (tipo_doc IN ('DNI', 'RUT', 'PASAPORTE', 'OTRO')) DEFAULT 'DNI',
  -- Contacto personal
  tel_personal    TEXT,
  email_personal  TEXT,
  -- Datos personales
  genero          TEXT CHECK (genero IN ('M', 'F', 'OTRO')) DEFAULT 'OTRO',
  direccion       TEXT,
  fon             TEXT, -- Fono de emergencia
  fecha_nacimiento DATE,
  -- Laboral
  fecha_ingreso   DATE NOT NULL,
  fecha_egreso    DATE,
  puesto_id       UUID REFERENCES rrhh_puestos(id) ON DELETE SET NULL,
  departamento_id UUID REFERENCES rrhh_departamentos(id) ON DELETE SET NULL,
  supervisor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  tipo_contrato   TEXT CHECK (tipo_contrato IN ('INDEFINIDO', 'PLAZO_FIJO', 'FREELANCE', 'TEMPORAL')) DEFAULT 'INDEFINIDO',
  salario_bruto   NUMERIC(12, 2), -- Monto en moneda del negocio
  -- Control
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  -- Constraints
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

-- Trigger para actualizar updated_at
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

-- Triggers similares para puestos y departamentos
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
-- 5. PUESTOS Y DEPARTAMENTOS DEFAULT (seed data)
-- ============================================================
-- Los tenants nuevos pueden crear estos via UI, pero agregamos algunos defaults
-- (comentados para que cada tenant cree los suyos)
-- Descomentar si se desea seed data automático con cada migration
/*
INSERT INTO rrhh_departamentos (tenant_id, nombre, descripcion, activo)
SELECT id, 'Administración', 'Área administrativa', TRUE FROM tenants
  ON CONFLICT DO NOTHING;

INSERT INTO rrhh_puestos (tenant_id, nombre, descripcion, salario_base_sugerido, activo)
SELECT id, 'Gerente', 'Gerente general del negocio', NULL, TRUE FROM tenants
  ON CONFLICT DO NOTHING;
*/
