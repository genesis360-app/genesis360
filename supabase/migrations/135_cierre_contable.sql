-- Migration 135: cierre contable mensual (HITO transversal)
-- Reglas de negocio Gastos · Fase 5 (v1.9.0)
--
-- Cierra periodos mensuales y bloquea UPDATE/DELETE de registros con fecha
-- anterior o igual al último periodo cerrado en Gastos, Ventas, Caja y OC.
-- Las correcciones se insertan como nuevo gasto con `es_correccion=TRUE` +
-- `gasto_padre_id` apuntando al original (que queda intocable).

-- ============================================================
-- 1) Tabla cierres_contables
-- ============================================================
CREATE TABLE IF NOT EXISTS cierres_contables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  periodo         DATE NOT NULL,
  fecha_cierre    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrado_por     UUID NOT NULL REFERENCES users(id),
  cerrado_por_rol TEXT NOT NULL,
  observaciones   TEXT,
  totales         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_cierres_tenant_periodo ON cierres_contables(tenant_id, periodo DESC);

ALTER TABLE cierres_contables ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='cierres_tenant' AND tablename='cierres_contables') THEN
    CREATE POLICY "cierres_tenant" ON cierres_contables FOR ALL
      USING      (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMENT ON TABLE  cierres_contables IS 'Cierres mensuales del libro contable. Un cierre congela todos los registros con fecha <= último día del periodo cerrado en Gastos, Ventas, Caja y OC.';
COMMENT ON COLUMN cierres_contables.periodo IS 'Primer día del mes cerrado (YYYY-MM-01).';

-- Normalizar siempre al día 1 del mes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name='cierres_periodo_first_day' AND table_name='cierres_contables'
  ) THEN
    ALTER TABLE cierres_contables
      ADD CONSTRAINT cierres_periodo_first_day
      CHECK (EXTRACT(DAY FROM periodo) = 1);
  END IF;
END $$;

-- ============================================================
-- 2) Notas de corrección en gastos
-- ============================================================
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS gasto_padre_id UUID REFERENCES gastos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS es_correccion  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN gastos.gasto_padre_id IS 'Si es_correccion=TRUE, apunta al gasto original que se está corrigiendo (que vive en un periodo cerrado y no se puede tocar).';
COMMENT ON COLUMN gastos.es_correccion  IS 'Marca el gasto como nota de corrección de otro gasto en periodo cerrado. Monto suele ser negativo (anular) o complementario.';

CREATE INDEX IF NOT EXISTS idx_gastos_padre ON gastos(gasto_padre_id) WHERE gasto_padre_id IS NOT NULL;

-- ============================================================
-- 3) Helpers: ultimo cierre + periodo_cerrado
-- ============================================================

-- Devuelve el último día del último periodo cerrado para el tenant, o NULL si no hay cierres
CREATE OR REPLACE FUNCTION ultimo_cierre_hasta(p_tenant_id UUID)
RETURNS DATE
LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('month', MAX(periodo)) + INTERVAL '1 month - 1 day')::DATE
  FROM cierres_contables
  WHERE tenant_id = p_tenant_id
$$;

COMMENT ON FUNCTION ultimo_cierre_hasta(UUID) IS 'Último día (DATE) del periodo cerrado más reciente del tenant. NULL si no hay cierres.';

-- TRUE si la fecha está dentro de un periodo cerrado
CREATE OR REPLACE FUNCTION periodo_cerrado(p_tenant_id UUID, p_fecha DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_fecha <= ultimo_cierre_hasta(p_tenant_id), FALSE)
$$;

COMMENT ON FUNCTION periodo_cerrado(UUID, DATE) IS 'TRUE si la fecha cae dentro del último periodo contable cerrado del tenant.';

-- ============================================================
-- 4) Trigger genérico de bloqueo: usa columna DATE/TIMESTAMPTZ configurable
-- ============================================================
-- Cada tabla con datos contables tiene su propia función trigger porque PG
-- no permite parámetros dinámicos en triggers; mantenemos la lógica idéntica.

-- ── gastos: bloquea UPDATE/DELETE si la fecha original (OLD.fecha) está cerrada
CREATE OR REPLACE FUNCTION trg_gastos_periodo_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cierre DATE;
BEGIN
  -- Las correcciones (es_correccion=TRUE) pueden insertarse sin chequear;
  -- las MODIFICACIONES sobre cualquier gasto en periodo cerrado se bloquean.
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.fecha <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — usá una nota de corrección en lugar de editar/eliminar gastos viejos.', v_cierre
      USING ERRCODE = 'P0001';
  END IF;
  -- En UPDATE, tampoco permitir mover la fecha hacia un periodo cerrado
  IF TG_OP = 'UPDATE' AND NEW.fecha IS NOT NULL THEN
    IF v_cierre IS NOT NULL AND NEW.fecha <= v_cierre THEN
      RAISE EXCEPTION 'No podés asignar a este gasto una fecha dentro de un periodo cerrado (% o anterior).', v_cierre
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_gastos_cierre ON gastos;
CREATE TRIGGER trg_gastos_cierre
  BEFORE UPDATE OR DELETE ON gastos
  FOR EACH ROW EXECUTE FUNCTION trg_gastos_periodo_cerrado();

-- ── ventas: usa created_at::date
CREATE OR REPLACE FUNCTION trg_ventas_periodo_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar ventas anteriores.', v_cierre
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_ventas_cierre ON ventas;
CREATE TRIGGER trg_ventas_cierre
  BEFORE UPDATE OR DELETE ON ventas
  FOR EACH ROW EXECUTE FUNCTION trg_ventas_periodo_cerrado();

-- ── caja_movimientos
CREATE OR REPLACE FUNCTION trg_caja_mov_periodo_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar movimientos de caja anteriores.', v_cierre
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_caja_mov_cierre ON caja_movimientos;
CREATE TRIGGER trg_caja_mov_cierre
  BEFORE UPDATE OR DELETE ON caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_caja_mov_periodo_cerrado();

-- ── caja_sesiones (usa abierta_at)
CREATE OR REPLACE FUNCTION trg_caja_ses_periodo_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.abierta_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar sesiones de caja anteriores.', v_cierre
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_caja_ses_cierre ON caja_sesiones;
CREATE TRIGGER trg_caja_ses_cierre
  BEFORE UPDATE OR DELETE ON caja_sesiones
  FOR EACH ROW EXECUTE FUNCTION trg_caja_ses_periodo_cerrado();

-- ── ordenes_compra (usa created_at)
CREATE OR REPLACE FUNCTION trg_oc_periodo_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_cierre DATE;
BEGIN
  v_cierre := ultimo_cierre_hasta(OLD.tenant_id);
  IF v_cierre IS NOT NULL AND OLD.created_at::DATE <= v_cierre THEN
    RAISE EXCEPTION 'Periodo contable cerrado hasta % — no podés modificar órdenes de compra anteriores.', v_cierre
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_oc_cierre ON ordenes_compra;
CREATE TRIGGER trg_oc_cierre
  BEFORE UPDATE OR DELETE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION trg_oc_periodo_cerrado();

-- ============================================================
-- 5) RPC: cerrar_periodo
-- ============================================================
-- Valida rol, que el periodo sea posterior al último cierre y crea el registro.
-- Devuelve la fila del cierre creado (como JSON para evitar dependencia de tipo).
CREATE OR REPLACE FUNCTION cerrar_periodo(
  p_periodo       DATE,
  p_observaciones TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_rol       TEXT;
  v_periodo   DATE := date_trunc('month', p_periodo)::DATE;
  v_ultimo    DATE;
  v_total_gastos     NUMERIC;
  v_total_ventas     NUMERIC;
  v_total_sueldos    NUMERIC;
  v_total_oc         NUMERIC;
  v_count_gastos     INT;
  v_count_ventas     INT;
  v_count_correcc    INT;
  v_row       cierres_contables;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT tenant_id, rol INTO v_tenant_id, v_rol FROM users WHERE id = v_user_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;

  IF v_rol NOT IN ('DUEÑO','SUPERVISOR','CONTADOR','SUPER_USUARIO','ADMIN') THEN
    RAISE EXCEPTION 'Tu rol (%) no puede cerrar periodos contables', v_rol;
  END IF;

  -- El periodo debe ser estrictamente posterior al último cerrado
  SELECT MAX(periodo) INTO v_ultimo FROM cierres_contables WHERE tenant_id = v_tenant_id;
  IF v_ultimo IS NOT NULL AND v_periodo <= v_ultimo THEN
    RAISE EXCEPTION 'El periodo % ya está cerrado o es anterior al último cierre (%)', TO_CHAR(v_periodo,'MM/YYYY'), TO_CHAR(v_ultimo,'MM/YYYY');
  END IF;

  -- No permitir cerrar un periodo en curso (debe estar finalizado)
  IF v_periodo >= date_trunc('month', CURRENT_DATE)::DATE THEN
    RAISE EXCEPTION 'No podés cerrar un periodo en curso o futuro (%)', TO_CHAR(v_periodo,'MM/YYYY');
  END IF;

  -- Calcular totales del periodo (snapshot)
  SELECT COALESCE(SUM(monto),0), COUNT(*),
         COUNT(*) FILTER (WHERE es_correccion = TRUE)
    INTO v_total_gastos, v_count_gastos, v_count_correcc
  FROM gastos
  WHERE tenant_id = v_tenant_id
    AND fecha >= v_periodo
    AND fecha <  (v_periodo + INTERVAL '1 month')::DATE;

  SELECT COALESCE(SUM(total),0), COUNT(*) INTO v_total_ventas, v_count_ventas
  FROM ventas
  WHERE tenant_id = v_tenant_id
    AND created_at >= v_periodo
    AND created_at <  (v_periodo + INTERVAL '1 month')::DATE
    AND estado IN ('despachada','facturada');

  SELECT COALESCE(SUM(neto),0) INTO v_total_sueldos
  FROM rrhh_salarios
  WHERE tenant_id = v_tenant_id
    AND pagado = TRUE
    AND fecha_pago >= v_periodo
    AND fecha_pago <  (v_periodo + INTERVAL '1 month')::DATE;

  SELECT COALESCE(SUM(total_oc),0) INTO v_total_oc
  FROM (
    SELECT COALESCE(SUM(oci.cantidad * oci.precio_unitario),0) AS total_oc
    FROM ordenes_compra oc
    LEFT JOIN orden_compra_items oci ON oci.orden_compra_id = oc.id
    WHERE oc.tenant_id = v_tenant_id
      AND oc.created_at >= v_periodo
      AND oc.created_at <  (v_periodo + INTERVAL '1 month')::DATE
    GROUP BY oc.id
  ) sub;

  INSERT INTO cierres_contables(tenant_id, periodo, cerrado_por, cerrado_por_rol, observaciones, totales)
  VALUES (
    v_tenant_id, v_periodo, v_user_id, v_rol, p_observaciones,
    jsonb_build_object(
      'total_gastos',      v_total_gastos,
      'total_ventas',      v_total_ventas,
      'total_sueldos',     v_total_sueldos,
      'total_oc',          v_total_oc,
      'count_gastos',      v_count_gastos,
      'count_ventas',      v_count_ventas,
      'count_correcciones',v_count_correcc
    )
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END $$;

GRANT EXECUTE ON FUNCTION cerrar_periodo(DATE, TEXT) TO authenticated;

COMMENT ON FUNCTION cerrar_periodo(DATE, TEXT) IS 'Cierra el periodo contable indicado (YYYY-MM-01). Requiere rol DUEÑO/SUPERVISOR/CONTADOR/ADMIN. Devuelve la fila del cierre + totales snapshot.';

-- ============================================================
-- 6) RPC: reabrir_periodo (sólo DUEÑO + SUPER_USUARIO + ADMIN)
-- ============================================================
-- Permite revertir el último cierre (no permite reabrir un cierre que no sea el último).
CREATE OR REPLACE FUNCTION reabrir_periodo(p_cierre_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tenant_id UUID;
  v_rol       TEXT;
  v_cierre    cierres_contables;
  v_ultimo    DATE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT tenant_id, rol INTO v_tenant_id, v_rol FROM users WHERE id = v_user_id;

  IF v_rol NOT IN ('DUEÑO','SUPER_USUARIO','ADMIN') THEN
    RAISE EXCEPTION 'Sólo DUEÑO/ADMIN pueden reabrir un cierre.';
  END IF;

  SELECT * INTO v_cierre FROM cierres_contables WHERE id = p_cierre_id AND tenant_id = v_tenant_id;
  IF v_cierre.id IS NULL THEN RAISE EXCEPTION 'Cierre no encontrado'; END IF;

  SELECT MAX(periodo) INTO v_ultimo FROM cierres_contables WHERE tenant_id = v_tenant_id;
  IF v_cierre.periodo <> v_ultimo THEN
    RAISE EXCEPTION 'Sólo se puede reabrir el último cierre (% es anterior a %)', TO_CHAR(v_cierre.periodo,'MM/YYYY'), TO_CHAR(v_ultimo,'MM/YYYY');
  END IF;

  DELETE FROM cierres_contables WHERE id = p_cierre_id;
  RETURN TRUE;
END $$;

GRANT EXECUTE ON FUNCTION reabrir_periodo(UUID) TO authenticated;
