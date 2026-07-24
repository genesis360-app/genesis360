-- ============================================================
-- 304_producto_presentaciones_precio_base.sql
-- FASE 2 del rediseño UoM/Empaque/Variantes (ver diseño-uom-empaque-variantes.html §4/§5/§6).
--
-- 🛑 TOCA PLATA (Regla de Oro #0). Dos cambios acoplados:
--
--  (A) PRECIO CANÓNICO EN LA UNIDAD BASE + overrides por presentación (decisión F1/F3 de GO).
--      Hoy `productos.precio_venta/costo` es el precio del nivel ANCLADO (`nivel_precio_orden`),
--      y el POS deriva el resto proporcionalmente al ancla. Ese "ancla por POSICIÓN" es un bug:
--      no se revalida al reordenar niveles / cambiar la estructura default → puede apuntar en
--      silencio a otra unidad. Se ELIMINA `productos.nivel_precio_orden`. A partir de acá
--      `productos.precio_venta/costo` es SIEMPRE el precio por unidad BASE (orden 1).
--      El precio de una presentación k = override propio ?? precio_base × factor_base(k).
--
--      Back-calc de los productos anclados (nivel_precio_orden > 1): matemáticamente exacto —
--      precio_base = precioEfectivoNivel(nivel base) = precio_anclado / unidades_base(nivel anclado).
--      Además, el precio que el usuario cargó en el nivel anclado se PERSISTE como override
--      explícito de ese nivel (si no tenía uno) para que ese empaque siga cobrándose EXACTO,
--      sin el drift de centavos de redondear el base y volver a multiplicar (Regla #0).
--
--  (B) Tabla nueva `producto_presentaciones` (decisión C5/C6 de GO): modelo PLANO donde cada
--      presentación declara su `factor_base` DIRECTO a la unidad base (no cadena lineal),
--      permitiendo hermanas (Caja-6 y Caja-9) a futuro. En esta fase se puebla 1:1 desde
--      `producto_estructura_niveles` (que SIGUE siendo la fuente de conversión para Recepciones/
--      Inventario/WMS hasta la Fase 5 "operar por presentación") y se mantiene sincronizada por
--      trigger. El precio de READ del POS pasa a leer presentaciones + base. Las hermanas
--      (mismo nombre de empaque, distinta etiqueta) quedan bloqueadas hasta la Fase 5 por el
--      `UNIQUE(producto_id, nombre_empaque_id)` — así el mirror a `niveles` (que tiene su propio
--      UNIQUE(estructura, unidad_medida)) nunca se rompe.
--
-- NO toca stock/movimientos/fiscal. `unidades_base` acumulado de la cadena actual ES el
-- `factor_base` nuevo → copia directa (probado contra datos reales en DEV: mig verificada con
-- los 6 productos anclados: Coca 3500/6=583.33, bolsa clavos 100/100=1, E2E ancla, 3× E2E UoM).
-- ============================================================

-- ── 1) Tabla producto_presentaciones ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS producto_presentaciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  producto_id       uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  -- Nombre de empaque (Unidad/Caja/Pallet) — FK a unidades_medida (que en el rediseño queda
  -- para NOMBRES de empaque). NULL admisible por si a futuro una presentación usa etiqueta libre.
  nombre_empaque_id uuid REFERENCES unidades_medida(id) ON DELETE RESTRICT,
  etiqueta          text NOT NULL,                      -- "Caja-6", display; a futuro distingue hermanas
  factor_base       bigint NOT NULL CHECK (factor_base >= 1),  -- unidades base por 1 de esta presentación
  es_base           boolean NOT NULL DEFAULT false,     -- la presentación base (factor 1 = la UdM del SKU)
  precio_venta      numeric(12,2) CHECK (precio_venta IS NULL OR precio_venta >= 0),  -- override, NULL = deriva
  precio_costo      numeric(12,2) CHECK (precio_costo IS NULL OR precio_costo >= 0),
  orden             int NOT NULL,
  activo            boolean NOT NULL DEFAULT true,
  peso_kg           numeric(10,4) CHECK (peso_kg  IS NULL OR peso_kg  > 0),
  alto_cm           numeric(10,2) CHECK (alto_cm  IS NULL OR alto_cm  > 0),
  ancho_cm          numeric(10,2) CHECK (ancho_cm IS NULL OR ancho_cm > 0),
  largo_cm          numeric(10,2) CHECK (largo_cm IS NULL OR largo_cm > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producto_id, etiqueta),
  -- Fase 2: 1:1 con niveles (sin hermanas). La Fase 5 levanta esta restricción cuando la
  -- conversión deje de leer producto_estructura_niveles.
  UNIQUE (producto_id, nombre_empaque_id)
);

COMMENT ON TABLE producto_presentaciones IS
  'Presentaciones de empaque de un SKU (modelo plano, factor_base DIRECTO a la unidad base). Fase 2 del rediseño UoM/Empaque/Variantes. Se puebla 1:1 desde producto_estructura_niveles y se mantiene por trigger fn_rebuild_presentaciones hasta la Fase 5.';
COMMENT ON COLUMN producto_presentaciones.factor_base IS
  'Unidades base que equivale 1 de esta presentación (= producto_estructura_niveles.unidades_base). La base tiene factor 1.';
COMMENT ON COLUMN producto_presentaciones.precio_venta IS
  'Precio de venta propio de esta presentación (override). NULL = deriva de productos.precio_venta × factor_base. La presentación base SIEMPRE deriva (override NULL) — el precio base vive en productos.precio_venta.';

CREATE INDEX IF NOT EXISTS idx_pp_producto ON producto_presentaciones (producto_id);
CREATE INDEX IF NOT EXISTS idx_pp_tenant   ON producto_presentaciones (tenant_id);
-- Una sola presentación base por producto
CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_una_base ON producto_presentaciones (producto_id) WHERE es_base;

ALTER TABLE producto_presentaciones ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'producto_presentaciones' AND policyname = 'pp_tenant') THEN
    CREATE POLICY pp_tenant ON producto_presentaciones FOR ALL
      USING (tenant_id = get_user_tenant_id())
      WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- Tabla 100% derivada (la mantiene fn_rebuild_presentaciones vía trigger, SECURITY DEFINER):
-- authenticated solo LEE. Nadie la escribe por REST — así ningún usuario puede pisar un
-- precio_venta arbitrario entre guardado y guardado (Regla #0). Las escrituras pasan siempre
-- por fn_estructura_guardar_niveles → trigger → fn_rebuild_presentaciones.
REVOKE ALL ON producto_presentaciones FROM PUBLIC, anon;
GRANT SELECT ON producto_presentaciones TO authenticated;
GRANT ALL ON producto_presentaciones TO service_role;

-- ── 2) fn_rebuild_presentaciones — reconstruye las presentaciones de un producto desde su
-- estructura DEFAULT (fuente de verdad de conversión en Fase 2). Idempotente. SECURITY DEFINER
-- (misma razón que los seeds: la llaman triggers y el backfill de migración, y escribe una
-- tabla con RLS scopeando por el tenant del propio producto). ──────────────────────────
CREATE OR REPLACE FUNCTION fn_rebuild_presentaciones(p_producto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_estr_id   uuid;
  v_min_orden int;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM productos WHERE id = p_producto_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_estr_id FROM producto_estructuras
    WHERE producto_id = p_producto_id AND is_default = true
    ORDER BY created_at LIMIT 1;

  DELETE FROM producto_presentaciones WHERE producto_id = p_producto_id;
  IF v_estr_id IS NULL THEN RETURN; END IF;

  SELECT min(orden) INTO v_min_orden FROM producto_estructura_niveles WHERE estructura_id = v_estr_id;
  IF v_min_orden IS NULL THEN RETURN; END IF;

  INSERT INTO producto_presentaciones
    (tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
     precio_venta, precio_costo, orden, activo, peso_kg, alto_cm, ancho_cm, largo_cm)
  SELECT
    v_tenant_id, p_producto_id, n.unidad_medida_id,
    COALESCE(um.nombre, 'Presentación ' || n.orden),
    n.unidades_base,
    (n.orden = v_min_orden),
    -- La base SIEMPRE deriva de productos.precio_venta (override NULL) — igual que el POS de hoy,
    -- que bakea productos.precio_venta en el nivel base. Los no-base copian su override propio.
    CASE WHEN n.orden = v_min_orden THEN NULL ELSE n.precio_venta END,
    CASE WHEN n.orden = v_min_orden THEN NULL ELSE n.precio_costo END,
    n.orden, true, n.peso_kg, n.alto_cm, n.ancho_cm, n.largo_cm
  FROM producto_estructura_niveles n
  LEFT JOIN unidades_medida um ON um.id = n.unidad_medida_id
  WHERE n.estructura_id = v_estr_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_rebuild_presentaciones(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_rebuild_presentaciones(uuid) TO service_role;

-- ── 3) Triggers de sincronización presentaciones ← niveles/estructura ────────────────────
CREATE OR REPLACE FUNCTION trg_sync_presentaciones_niveles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_producto_id uuid;
BEGIN
  SELECT producto_id INTO v_producto_id FROM producto_estructuras
    WHERE id = COALESCE(NEW.estructura_id, OLD.estructura_id);
  IF v_producto_id IS NOT NULL THEN
    PERFORM fn_rebuild_presentaciones(v_producto_id);
  END IF;
  RETURN NULL;  -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_pp_sync_niveles ON producto_estructura_niveles;
CREATE TRIGGER trg_pp_sync_niveles
  AFTER INSERT OR UPDATE OR DELETE ON producto_estructura_niveles
  FOR EACH ROW EXECUTE FUNCTION trg_sync_presentaciones_niveles();

CREATE OR REPLACE FUNCTION trg_sync_presentaciones_estructura()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_rebuild_presentaciones(COALESCE(NEW.producto_id, OLD.producto_id));
  RETURN NULL;
END;
$$;

-- Cuando cambia cuál estructura es la default (o se borra/crea), cambia la fuente de presentaciones.
DROP TRIGGER IF EXISTS trg_pp_sync_estructura ON producto_estructuras;
CREATE TRIGGER trg_pp_sync_estructura
  AFTER INSERT OR UPDATE OF is_default OR DELETE ON producto_estructuras
  FOR EACH ROW EXECUTE FUNCTION trg_sync_presentaciones_estructura();

-- ── 4) Back-calc de PLATA de los productos anclados (nivel_precio_orden > 1) ─────────────
-- Persiste el precio del nivel anclado como override explícito (si no tenía) y recalcula el
-- precio de cabecera a "por unidad base". Espeja precioEfectivoNivel(nivel base) de estructuras.ts.
-- Guard de idempotencia: si la columna ya no existe (re-corrida tras el DROP de la sección 6),
-- este bloque se saltea entero — nunca vuelve a dividir un precio ya convertido.
DO $$
DECLARE
  p          RECORD;
  v_estr_id  uuid;
  v_ub_ancla numeric;
  v_niv1_pv  numeric;
  v_niv1_pc  numeric;
  v_min_orden int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productos' AND column_name = 'nivel_precio_orden'
  ) THEN
    RAISE NOTICE 'nivel_precio_orden ya no existe — back-calc ya aplicado, se saltea.';
    RETURN;
  END IF;

  FOR p IN
    SELECT id, precio_venta, precio_costo, nivel_precio_orden
    FROM productos
    WHERE nivel_precio_orden IS NOT NULL AND nivel_precio_orden > 1
  LOOP
    SELECT id INTO v_estr_id FROM producto_estructuras
      WHERE producto_id = p.id AND is_default = true ORDER BY created_at LIMIT 1;
    IF v_estr_id IS NULL THEN CONTINUE; END IF;

    SELECT min(orden) INTO v_min_orden FROM producto_estructura_niveles WHERE estructura_id = v_estr_id;

    -- unidades_base del nivel anclado; si el ancla ya no existe (estructura se achicó), red de
    -- seguridad: dejar precio_venta tal cual (se interpreta como base, igual que ordenAnclaEfectivo).
    SELECT unidades_base INTO v_ub_ancla FROM producto_estructura_niveles
      WHERE estructura_id = v_estr_id AND orden = p.nivel_precio_orden;
    IF v_ub_ancla IS NULL OR v_ub_ancla <= 0 THEN CONTINUE; END IF;

    -- override propio del nivel base, si lo tuviera (precioEfectivoNivel(base) lo respetaría)
    SELECT precio_venta, precio_costo INTO v_niv1_pv, v_niv1_pc
      FROM producto_estructura_niveles WHERE estructura_id = v_estr_id AND orden = v_min_orden;

    -- (a) el precio que el usuario cargó en el nivel anclado → override explícito de ese nivel
    --     (solo si no tenía uno; si ya tenía override propio, ese gana — caso E2E PrecioUoM).
    UPDATE producto_estructura_niveles
      SET precio_venta = COALESCE(precio_venta, p.precio_venta),
          precio_costo = COALESCE(precio_costo, p.precio_costo)
      WHERE estructura_id = v_estr_id AND orden = p.nivel_precio_orden;

    -- (b) precio_base = override del base ?? precio_anclado / unidades_base(ancla)  (ub_base = 1)
    UPDATE productos
      SET precio_venta = COALESCE(v_niv1_pv, round(p.precio_venta / v_ub_ancla, 2)),
          precio_costo = COALESCE(v_niv1_pc, round(p.precio_costo / v_ub_ancla, 2))
      WHERE id = p.id;
  END LOOP;
END $$;

-- ── 5) Backfill de presentaciones para todos los productos con estructura default ────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT producto_id FROM producto_estructuras WHERE is_default = true LOOP
    PERFORM fn_rebuild_presentaciones(r.producto_id);
  END LOOP;
END $$;

-- ── 6) Eliminar el ancla por posición (bug F3) ───────────────────────────────────────────
ALTER TABLE productos DROP COLUMN IF EXISTS nivel_precio_orden;

-- ── 7) fn_estructura_guardar_niveles SIN el bloque de nivel_precio_orden ─────────────────
-- La versión de mig 287 terminaba con un UPDATE productos SET nivel_precio_orden = NULL — al
-- dropear la columna eso rompería TODO guardado de estructura. Se reescribe idéntica salvo ese
-- bloque final (ya no hace falta: no hay ancla que invalidar). El resto (validaciones, precios
-- por nivel) intacto. El trigger trg_pp_sync_niveles rebuildea presentaciones tras este guardado.
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
  SELECT tenant_id INTO v_tenant_id FROM producto_estructuras WHERE id = p_estructura_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Estructura inexistente o sin permisos';
  END IF;

  IF p_niveles IS NULL OR jsonb_typeof(p_niveles) <> 'array' OR jsonb_array_length(p_niveles) < 1 THEN
    RAISE EXCEPTION 'La estructura necesita al menos un nivel';
  END IF;

  SELECT count(DISTINCT n->>'unidad_medida_id') INTO v_udm_count
  FROM jsonb_array_elements(p_niveles) n;
  IF v_udm_count <> jsonb_array_length(p_niveles) THEN
    RAISE EXCEPTION 'No se puede repetir la misma unidad de medida en dos niveles';
  END IF;

  DELETE FROM producto_estructura_niveles WHERE estructura_id = p_estructura_id;

  FOR v_nivel IN SELECT * FROM jsonb_array_elements(p_niveles) LOOP
    v_orden := v_orden + 1;
    v_udm_id := (v_nivel->>'unidad_medida_id')::uuid;

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

    IF (v_nivel->>'precio_venta') IS NOT NULL AND (v_nivel->>'precio_venta')::numeric < 0 THEN
      RAISE EXCEPTION 'El precio de venta del nivel % no puede ser negativo', v_orden;
    END IF;
    IF (v_nivel->>'precio_costo') IS NOT NULL AND (v_nivel->>'precio_costo')::numeric < 0 THEN
      RAISE EXCEPTION 'El costo del nivel % no puede ser negativo', v_orden;
    END IF;

    INSERT INTO producto_estructura_niveles
      (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base,
       peso_kg, alto_cm, ancho_cm, largo_cm, precio_venta, precio_costo)
    VALUES
      (v_tenant_id, p_estructura_id, v_udm_id, v_orden, v_factor, v_acumulado,
       NULLIF(v_nivel->>'peso_kg',  '')::numeric,
       NULLIF(v_nivel->>'alto_cm',  '')::numeric,
       NULLIF(v_nivel->>'ancho_cm', '')::numeric,
       NULLIF(v_nivel->>'largo_cm', '')::numeric,
       NULLIF(v_nivel->>'precio_venta', '')::numeric,
       NULLIF(v_nivel->>'precio_costo', '')::numeric);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION fn_estructura_guardar_niveles(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_estructura_guardar_niveles(uuid, jsonb) TO authenticated, service_role;
