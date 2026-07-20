-- 282: Estructuras de producto con niveles dinámicos por Unidad de Medida (estilo
-- "pack structure / footprint" de Blue Yonder).
--
-- Contexto (pedido GO): producto_estructuras (mig 031) tenía los 3 niveles HARDCODEADOS
-- como columnas (unidad/caja/pallet) y las unidades_medida del tenant (mig 119) no se
-- conectaban con nada (solo etiqueta de texto en productos.unidad_medida). Ahora cada
-- estructura tiene N niveles ordenados, cada nivel apunta a una UdM del tenant, con
-- factor de conversión CONTRA EL NIVEL ANTERIOR (caja = 12 unidades, pallet = 40 cajas)
-- y peso/dimensiones propias. La equivalencia total en unidad base (unidades_base) se
-- calcula y persiste server-side — el cliente nunca la manda (REGLA #0 inventario:
-- conversiones exactas, factores enteros).
--
-- Las columnas fijas viejas de producto_estructuras QUEDAN (deprecadas, el frontend deja
-- de leerlas en este mismo release) — se droppean en una migración de limpieza futura,
-- una vez verificado el release en PROD. PROD tiene 0 estructuras cargadas a la fecha.

-- ── 1) Tabla de niveles ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS producto_estructura_niveles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estructura_id    uuid NOT NULL REFERENCES producto_estructuras(id) ON DELETE CASCADE,
  unidad_medida_id uuid NOT NULL REFERENCES unidades_medida(id) ON DELETE RESTRICT,
  orden            integer NOT NULL CHECK (orden >= 1),
  -- Cuántos del nivel ANTERIOR contiene este nivel (el nivel base tiene factor 1).
  factor           integer NOT NULL DEFAULT 1 CHECK (factor >= 1),
  -- Equivalencia total en la UdM base de la estructura (producto acumulado de factores).
  -- La calcula fn_estructura_guardar_niveles — no confiar en el valor que mande el cliente.
  unidades_base    bigint  NOT NULL DEFAULT 1 CHECK (unidades_base >= 1),
  peso_kg          numeric(10,4) CHECK (peso_kg  IS NULL OR peso_kg  > 0),
  alto_cm          numeric(10,2) CHECK (alto_cm  IS NULL OR alto_cm  > 0),
  ancho_cm         numeric(10,2) CHECK (ancho_cm IS NULL OR ancho_cm > 0),
  largo_cm         numeric(10,2) CHECK (largo_cm IS NULL OR largo_cm > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estructura_id, orden),
  UNIQUE (estructura_id, unidad_medida_id)
);

COMMENT ON TABLE producto_estructura_niveles IS
  'Niveles dinámicos de una estructura de producto (footprint). orden=1 es la UdM base; factor = cuántos del nivel anterior contiene; unidades_base = equivalencia total en la UdM base (server-computed). Reemplaza las columnas fijas unidad/caja/pallet de producto_estructuras (deprecadas).';

CREATE INDEX IF NOT EXISTS idx_pen_estructura ON producto_estructura_niveles (estructura_id);
CREATE INDEX IF NOT EXISTS idx_pen_tenant     ON producto_estructura_niveles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pen_udm        ON producto_estructura_niveles (unidad_medida_id);

ALTER TABLE producto_estructura_niveles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'producto_estructura_niveles' AND policyname = 'pen_tenant') THEN
    CREATE POLICY pen_tenant ON producto_estructura_niveles FOR ALL
      USING (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())))
      WITH CHECK (tenant_id IN (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())));
  END IF;
END $$;

REVOKE ALL ON producto_estructura_niveles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON producto_estructura_niveles TO authenticated;
GRANT ALL ON producto_estructura_niveles TO service_role;

-- ── 2) RPC transaccional de guardado ───────────────────────────────────────────────────
-- Reemplaza TODOS los niveles de una estructura en una sola transacción, validando
-- server-side (la UI también valida, pero la UI se cachea/bypassea):
--   · la estructura existe y es visible por el caller (SECURITY INVOKER → aplica RLS)
--   · al menos 1 nivel; factores enteros >= 1 (>= 2 desde el 2º nivel: un nivel que
--     contiene 1 del anterior no aporta conversión, pero se permite >= 1 por si un
--     tenant modela "display = 1 caja" con dimensiones distintas)
--   · UdM sin repetir; todas visibles por el caller (RLS de unidades_medida)
-- p_niveles: array JSON ordenado (el primero es la base):
--   [{"unidad_medida_id":"…","factor":1,"peso_kg":1.5,"alto_cm":10,"ancho_cm":5,"largo_cm":5}, …]
-- El factor del primer nivel se fuerza a 1. unidades_base se calcula acá.

CREATE OR REPLACE FUNCTION fn_estructura_guardar_niveles(
  p_estructura_id uuid,
  p_niveles       jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_nivel      jsonb;
  v_orden      integer := 0;
  v_factor     integer;
  v_udm_id     uuid;
  v_acumulado  bigint := 1;
  v_udm_count  integer;
BEGIN
  -- RLS aplica (SECURITY INVOKER): si la estructura no es del tenant del caller, no se ve.
  SELECT tenant_id INTO v_tenant_id FROM producto_estructuras WHERE id = p_estructura_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Estructura inexistente o sin permisos';
  END IF;

  IF p_niveles IS NULL OR jsonb_typeof(p_niveles) <> 'array' OR jsonb_array_length(p_niveles) < 1 THEN
    RAISE EXCEPTION 'La estructura necesita al menos un nivel';
  END IF;

  -- UdM repetidas dentro del array
  SELECT count(DISTINCT n->>'unidad_medida_id') INTO v_udm_count
  FROM jsonb_array_elements(p_niveles) n;
  IF v_udm_count <> jsonb_array_length(p_niveles) THEN
    RAISE EXCEPTION 'No se puede repetir la misma unidad de medida en dos niveles';
  END IF;

  DELETE FROM producto_estructura_niveles WHERE estructura_id = p_estructura_id;

  FOR v_nivel IN SELECT * FROM jsonb_array_elements(p_niveles) LOOP
    v_orden := v_orden + 1;
    v_udm_id := (v_nivel->>'unidad_medida_id')::uuid;

    -- La UdM debe ser visible por el caller (RLS) y del mismo tenant que la estructura.
    IF NOT EXISTS (SELECT 1 FROM unidades_medida WHERE id = v_udm_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Unidad de medida inválida en el nivel %', v_orden;
    END IF;

    IF v_orden = 1 THEN
      v_factor := 1;
    ELSE
      v_factor := (v_nivel->>'factor')::integer;
      IF v_factor IS NULL OR v_factor < 1 THEN
        RAISE EXCEPTION 'El factor del nivel % debe ser un entero mayor o igual a 1', v_orden;
      END IF;
    END IF;

    v_acumulado := v_acumulado * v_factor;

    INSERT INTO producto_estructura_niveles
      (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base,
       peso_kg, alto_cm, ancho_cm, largo_cm)
    VALUES
      (v_tenant_id, p_estructura_id, v_udm_id, v_orden, v_factor, v_acumulado,
       NULLIF(v_nivel->>'peso_kg',  '')::numeric,
       NULLIF(v_nivel->>'alto_cm',  '')::numeric,
       NULLIF(v_nivel->>'ancho_cm', '')::numeric,
       NULLIF(v_nivel->>'largo_cm', '')::numeric);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION fn_estructura_guardar_niveles(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_estructura_guardar_niveles(uuid, jsonb) TO authenticated, service_role;

-- ── 3) "Pallet" como UdM predefinida ───────────────────────────────────────────────────
-- El seed de tenants nuevos (fn_seed_tenant_defaults, última versión en mig 232) sembraba
-- Unidad/Kilogramo/Gramo/Litro/Metro/Caja. Se agrega Pallet para que toda estructura pueda
-- armarse out-of-the-box. SECURITY DEFINER obligatorio: el trigger corre AFTER INSERT ON
-- tenants ANTES de que exista la fila en users (gotcha mig 166).

CREATE OR REPLACE FUNCTION fn_seed_tenant_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sucursal_id UUID;
  v_efectivo_cuenta_id UUID;
BEGIN
  v_sucursal_id := gen_random_uuid();
  INSERT INTO sucursales (id, tenant_id, nombre, activo)
  VALUES (v_sucursal_id, NEW.id, 'Sucursal 1', true);

  INSERT INTO cajas (tenant_id, nombre, sucursal_id)
  VALUES (NEW.id, 'Caja Principal', v_sucursal_id);

  INSERT INTO motivos_movimiento (tenant_id, nombre, tipo, es_sistema) VALUES
    (NEW.id, 'Compra a proveedor',     'ingreso', true),
    (NEW.id, 'Ingreso inicial',         'ingreso', true),
    (NEW.id, 'Devolución de cliente',   'ingreso', true),
    (NEW.id, 'Venta',                   'rebaje', true),
    (NEW.id, 'Merma / Rotura',          'rebaje', true),
    (NEW.id, 'Consumo interno',         'rebaje', true),
    (NEW.id, 'Vencimiento',             'rebaje', true),
    (NEW.id, 'Ingreso de efectivo',     'caja',   true),
    (NEW.id, 'Extracción / Retiro',     'caja',   true),
    (NEW.id, 'Gastos varios',           'caja',   true),
    (NEW.id, 'Ajuste de inventario',    'ambos',  true);

  INSERT INTO estados_inventario (tenant_id, nombre, color, es_devolucion, es_disponible_venta, es_disponible_tn, es_disponible_meli) VALUES
    (NEW.id, 'Disponible', '#22c55e', false, true,  true,  true),
    (NEW.id, 'Bloqueado',  '#ef4444', false, false, false, false);

  INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida) VALUES
    (NEW.id, 'Unidad',     'u',      true, true),
    (NEW.id, 'Kilogramo',  'kg',     true, true),
    (NEW.id, 'Gramo',      'g',      true, true),
    (NEW.id, 'Litro',      'L',      true, true),
    (NEW.id, 'Metro',      'm',      true, true),
    (NEW.id, 'Caja',       'caja',   true, true),
    (NEW.id, 'Pallet',     'pallet', true, true)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  INSERT INTO cuentas_origen (tenant_id, nombre, tipo, moneda, activo)
  VALUES (NEW.id, 'Efectivo', 'efectivo', COALESCE(NEW.moneda, 'ARS'), true)
  RETURNING id INTO v_efectivo_cuenta_id;

  INSERT INTO metodos_pago (tenant_id, nombre, color, orden, activo, es_sistema, cuenta_origen_id) VALUES
    (NEW.id, 'Efectivo',           '#22c55e', 1, true, true, v_efectivo_cuenta_id),
    (NEW.id, 'Mercado Pago',       '#06b6d4', 2, true, true, NULL),
    (NEW.id, 'Tarjeta de débito',  '#eab308', 3, true, true, NULL),
    (NEW.id, 'Transferencia',      '#8b5cf6', 4, true, true, NULL),
    (NEW.id, 'Tarjeta de crédito', '#f97316', 5, true, true, NULL)
  ON CONFLICT (tenant_id, nombre) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Backfill Pallet para tenants existentes
INSERT INTO unidades_medida (tenant_id, nombre, simbolo, activo, predefinida)
SELECT t.id, 'Pallet', 'pallet', true, true
FROM tenants t
ON CONFLICT (tenant_id, nombre) DO UPDATE SET predefinida = true;

-- ── 4) Backfill de estructuras existentes → niveles ────────────────────────────────────
-- Convierte las columnas fijas a filas de niveles usando las UdM predefinidas del tenant.
-- Criterio de "nivel activo" idéntico al helper nivelActivo del frontend viejo:
-- peso IS NOT NULL AND alto IS NOT NULL. Solo corre para estructuras que aún no tienen
-- niveles (idempotente). PROD: 0 filas; DEV: datos de prueba.

DO $$
DECLARE
  e RECORD;
  v_udm_unidad uuid;
  v_udm_caja   uuid;
  v_udm_pallet uuid;
  v_orden      integer;
  v_acum       bigint;
  v_factor     integer;
BEGIN
  FOR e IN
    SELECT pe.* FROM producto_estructuras pe
    WHERE NOT EXISTS (SELECT 1 FROM producto_estructura_niveles n WHERE n.estructura_id = pe.id)
  LOOP
    SELECT id INTO v_udm_unidad FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Unidad';
    SELECT id INTO v_udm_caja   FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Caja';
    SELECT id INTO v_udm_pallet FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Pallet';
    IF v_udm_unidad IS NULL OR v_udm_caja IS NULL OR v_udm_pallet IS NULL THEN
      RAISE EXCEPTION 'Tenant % sin UdM predefinidas — correr el backfill de Pallet primero', e.tenant_id;
    END IF;

    v_orden := 0; v_acum := 1;

    IF e.peso_unidad IS NOT NULL AND e.alto_unidad IS NOT NULL THEN
      v_orden := v_orden + 1;
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
      VALUES (e.tenant_id, e.id, v_udm_unidad, v_orden, 1, 1, e.peso_unidad, e.alto_unidad, e.ancho_unidad, e.largo_unidad);
    END IF;

    IF e.peso_caja IS NOT NULL AND e.alto_caja IS NOT NULL THEN
      v_orden := v_orden + 1;
      -- Si la caja es el primer nivel (estructura vieja caja+pallet sin unidad), factor 1.
      v_factor := CASE WHEN v_orden = 1 THEN 1 ELSE GREATEST(COALESCE(e.unidades_por_caja, 1), 1) END;
      v_acum := v_acum * v_factor;
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
      VALUES (e.tenant_id, e.id, v_udm_caja, v_orden, v_factor, v_acum, e.peso_caja, e.alto_caja, e.ancho_caja, e.largo_caja);
    END IF;

    IF e.peso_pallet IS NOT NULL AND e.alto_pallet IS NOT NULL THEN
      v_orden := v_orden + 1;
      IF v_orden = 1 THEN
        v_factor := 1;
      ELSIF e.peso_caja IS NOT NULL AND e.alto_caja IS NOT NULL THEN
        -- Nivel anterior = caja
        v_factor := GREATEST(COALESCE(e.cajas_por_pallet, 1), 1);
      ELSE
        -- Nivel anterior = unidad (sin caja): el modelo viejo expresaba el pallet en cajas,
        -- así que unidades por pallet = cajas_por_pallet × unidades_por_caja.
        v_factor := GREATEST(COALESCE(e.cajas_por_pallet, 1) * COALESCE(e.unidades_por_caja, 1), 1);
      END IF;
      v_acum := v_acum * v_factor;
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
      VALUES (e.tenant_id, e.id, v_udm_pallet, v_orden, v_factor, v_acum, e.peso_pallet, e.alto_pallet, e.ancho_pallet, e.largo_pallet);
    END IF;

    -- Estructura vieja sin ningún nivel con peso+alto (no debería existir por la
    -- validación de UI vieja, pero por las dudas): nivel base Unidad pelado.
    IF v_orden = 0 THEN
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base)
      VALUES (e.tenant_id, e.id, v_udm_unidad, 1, 1, 1);
    END IF;
  END LOOP;
END $$;

-- ── 5) Deprecar columnas fijas viejas ──────────────────────────────────────────────────
COMMENT ON COLUMN producto_estructuras.unidades_por_caja IS 'DEPRECADA (mig 282) — usar producto_estructura_niveles.factor';
COMMENT ON COLUMN producto_estructuras.cajas_por_pallet  IS 'DEPRECADA (mig 282) — usar producto_estructura_niveles.factor';
