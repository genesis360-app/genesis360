-- ============================================================
-- 310_presentaciones_fuente_de_verdad.sql
-- FASE 5 del rediseño UoM/Empaque/Variantes — chunk A.
--
-- Invierte la fuente de verdad del EMPAQUE: hasta ahora `producto_presentaciones` (mig 304/307)
-- era un ESPEJO derivado por trigger de `producto_estructura_niveles` (la cadena lineal de la
-- mig 282). A partir de acá `producto_presentaciones` es la FUENTE, y `producto_estructuras` /
-- `producto_estructura_niveles` quedan deprecadas (se conservan: `inventario_lineas.estructura_id`
-- las referencia como histórico de recepción — borrarlas sería perder trazabilidad, Regla #0).
--
-- Qué habilita:
--  1) HERMANAS (pedido explícito de Fede): dos presentaciones del MISMO nombre de empaque con
--     factores distintos — "Caja-12" y "Caja-10" del mismo producto. Hoy lo impedía el
--     UNIQUE (producto_id, nombre_empaque_id); se levanta. Sigue vigente UNIQUE(producto_id,
--     etiqueta) y UNIQUE(producto_id, orden): lo que tiene que ser único es el NOMBRE visible.
--  2) Que el árbol genealógico se edite de verdad (`fn_presentaciones_guardar`), en vez de
--     derivarse de una cadena lineal que no puede expresar hermanas.
--
-- 🛑 Regla #0 (INVENTARIO): el backfill NO inventa ni pierde conversiones. `unidades_base` de cada
-- nivel ES el `factor_base` de la presentación (mismo número, ya validado entero). Las estructuras
-- NO-default, que hasta hoy eran letra muerta (el rebuild solo miraba la default), se RECUPERAN
-- como hermanas: en DEV son "Leche La Serenísima 1L" (Caja-12/Pallet-216 + Caja-10/Pallet-360) y
-- "Cellulse Mini Rolling Paper" (Caja-20 + Caja-15).
--
-- El PRECIO no se toca: sigue viviendo solo en la unidad base + tiers (mig 306/307). El empaque es
-- logística pura, sin precio propio.
-- ============================================================

DO $$
DECLARE
  v_primera_corrida boolean;
  v_prod            RECORD;
  v_estr            RECORD;
  v_niv             RECORD;
  v_base_id         uuid;
  v_padre_id        uuid;
  v_nueva_id        uuid;
  v_orden           int;
  v_etiqueta        text;
  v_etiqueta_base   text;
  v_i               int;
BEGIN
  -- El UNIQUE de (producto, nombre_empaque) solo existe ANTES de esta migración: sirve de marca
  -- de "primera corrida". Así, si el archivo se re-ejecuta, el backfill NO pisa las presentaciones
  -- que el usuario ya editó a mano (que a partir de ahora son la fuente de verdad).
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'producto_presentaciones_producto_id_nombre_empaque_id_key'
  ) INTO v_primera_corrida;

  -- ── 1) Habilitar hermanas ──────────────────────────────────────────────────────────────
  ALTER TABLE producto_presentaciones
    DROP CONSTRAINT IF EXISTS producto_presentaciones_producto_id_nombre_empaque_id_key;

  -- ── 2) Cortar la derivación desde la cadena lineal ─────────────────────────────────────
  DROP TRIGGER IF EXISTS trg_pp_sync_niveles   ON producto_estructura_niveles;
  DROP TRIGGER IF EXISTS trg_pp_sync_estructura ON producto_estructuras;

  IF NOT v_primera_corrida THEN
    RAISE NOTICE 'mig 310: backfill omitido (ya corrió antes)';
    RETURN;
  END IF;

  -- ── 3) Backfill ────────────────────────────────────────────────────────────────────────
  FOR v_prod IN
    SELECT p.id, p.tenant_id, NULLIF(btrim(p.unidad_medida), '') AS udm_ficha
    FROM productos p
  LOOP
    -- Se reconstruye de cero: hasta esta migración las presentaciones eran 100% derivadas,
    -- así que no hay edición manual del usuario que perder.
    DELETE FROM producto_presentaciones WHERE producto_id = v_prod.id;

    -- (a) Presentación BASE — siempre existe, factor 1, sin padre. Su etiqueta sale de la
    --     unidad de medida de la FICHA (H2, decisión de Fede en mig 307). Se arrastran el peso y
    --     las dimensiones que ya tuviera cargado el nivel más chico de la estructura default:
    --     son datos físicos reales, perderlos en silencio sería una regresión.
    v_etiqueta_base := COALESCE(v_prod.udm_ficha, 'Unidad');
    v_base_id := gen_random_uuid();
    INSERT INTO producto_presentaciones
      (id, tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
       padre_linea_id, orden, activo, peso_kg, alto_cm, ancho_cm, largo_cm)
    SELECT v_base_id, v_prod.tenant_id, v_prod.id, NULL, v_etiqueta_base, 1, true, NULL, 0, true,
           n.peso_kg, n.alto_cm, n.ancho_cm, n.largo_cm
    FROM (SELECT NULL::numeric AS peso_kg, NULL::numeric AS alto_cm,
                 NULL::numeric AS ancho_cm, NULL::numeric AS largo_cm) vacio
    LEFT JOIN LATERAL (
      SELECT x.peso_kg, x.alto_cm, x.ancho_cm, x.largo_cm
      FROM producto_estructuras e
      JOIN producto_estructura_niveles x ON x.estructura_id = e.id
      WHERE e.producto_id = v_prod.id AND e.is_default
      ORDER BY x.orden LIMIT 1
    ) n ON true;

    v_orden := 0;

    -- (b) Una rama por estructura. La default primero (queda con los `orden` más bajos);
    --     las demás se suman como HERMANAS colgando de la misma base.
    FOR v_estr IN
      SELECT e.id, e.nombre
      FROM producto_estructuras e
      WHERE e.producto_id = v_prod.id
      ORDER BY e.is_default DESC, e.created_at, e.id
    LOOP
      v_padre_id := v_base_id;

      -- Los niveles por encima del más chico. El nivel más chico de cada estructura ES la base
      -- (factor 1) y ya está representado por la presentación base → se saltea.
      FOR v_niv IN
        SELECT n.unidades_base, n.unidad_medida_id, n.peso_kg, n.alto_cm, n.ancho_cm, n.largo_cm,
               COALESCE(um.nombre, 'Presentación') AS udm_nombre
        FROM producto_estructura_niveles n
        LEFT JOIN unidades_medida um ON um.id = n.unidad_medida_id
        WHERE n.estructura_id = v_estr.id
          AND n.orden > (SELECT min(x.orden) FROM producto_estructura_niveles x WHERE x.estructura_id = v_estr.id)
        ORDER BY n.orden
      LOOP
        -- Etiqueta única por producto. "Caja" a secas si se puede; si ya existe (hermana),
        -- "Caja-12" (el factor la desambigua, que es justo como las nombra Fede).
        v_etiqueta := v_niv.udm_nombre;
        IF EXISTS (SELECT 1 FROM producto_presentaciones
                   WHERE producto_id = v_prod.id AND etiqueta = v_etiqueta) THEN
          v_etiqueta := v_niv.udm_nombre || '-' || v_niv.unidades_base;
        END IF;
        v_i := 1;
        WHILE EXISTS (SELECT 1 FROM producto_presentaciones
                      WHERE producto_id = v_prod.id AND etiqueta = v_etiqueta) LOOP
          v_etiqueta := v_niv.udm_nombre || '-' || v_niv.unidades_base || ' (' || v_i || ')';
          v_i := v_i + 1;
        END LOOP;

        v_orden := v_orden + 1;
        v_nueva_id := gen_random_uuid();
        INSERT INTO producto_presentaciones
          (id, tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
           padre_linea_id, orden, activo, peso_kg, alto_cm, ancho_cm, largo_cm)
        VALUES
          (v_nueva_id, v_prod.tenant_id, v_prod.id, v_niv.unidad_medida_id, v_etiqueta,
           v_niv.unidades_base, false, v_padre_id, v_orden, true,
           v_niv.peso_kg, v_niv.alto_cm, v_niv.ancho_cm, v_niv.largo_cm);

        -- Dentro de una estructura la cadena es lineal: cada nivel cuelga del anterior.
        v_padre_id := v_nueva_id;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- ── 4) Guardar el árbol de presentaciones (reemplaza fn_estructura_guardar_niveles) ───────
-- p_lineas: array ORDENADO; cada elemento puede referenciar como padre a un índice ANTERIOR
-- (`padre_idx`), lo que hace imposible construir un ciclo desde la UI.
--   [{"padre_idx":null,"nombre_empaque_id":null,"etiqueta":"Unidad","factor_base":1},
--    {"padre_idx":0,"nombre_empaque_id":"<uuid>","etiqueta":"Caja-12","factor_base":12},
--    {"padre_idx":1,"nombre_empaque_id":"<uuid>","etiqueta":"Pallet","factor_base":216}]
CREATE OR REPLACE FUNCTION public.fn_presentaciones_guardar(
  p_producto_id uuid,
  p_lineas      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant uuid;
  v_prod_tenant   uuid;
  v_n             int;
  v_i             int;
  v_linea         jsonb;
  v_padre_idx     int;
  v_factor        bigint;
  v_factor_padre  bigint;
  v_etiqueta      text;
  v_empaque       uuid;
  v_ids           uuid[];
  v_nueva_id      uuid;
  v_bases         int := 0;
BEGIN
  SELECT tenant_id INTO v_caller_tenant FROM users WHERE id = auth.uid();
  IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin tenant'; END IF;

  SELECT tenant_id INTO v_prod_tenant FROM productos WHERE id = p_producto_id;
  IF v_prod_tenant IS NULL THEN RAISE EXCEPTION 'El producto no existe'; END IF;
  IF v_prod_tenant IS DISTINCT FROM v_caller_tenant THEN RAISE EXCEPTION 'No autorizado'; END IF;

  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 1 THEN
    RAISE EXCEPTION 'El producto necesita al menos la presentación base';
  END IF;
  v_n := jsonb_array_length(p_lineas);

  -- ── Validación completa ANTES de tocar nada ──
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_linea    := p_lineas -> v_i;
    v_etiqueta := btrim(COALESCE(v_linea->>'etiqueta', ''));
    v_factor   := NULLIF(v_linea->>'factor_base', '')::bigint;

    IF v_etiqueta = '' THEN
      RAISE EXCEPTION 'La presentación %ª no tiene nombre', v_i + 1;
    END IF;
    IF v_factor IS NULL OR v_factor < 1 THEN
      RAISE EXCEPTION '"%": la equivalencia en unidades base debe ser un entero ≥ 1', v_etiqueta;
    END IF;

    -- Etiqueta única dentro del producto
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS t(el, ord)
      WHERE t.ord - 1 < v_i AND btrim(COALESCE(t.el->>'etiqueta','')) = v_etiqueta
    ) THEN
      RAISE EXCEPTION 'Hay dos presentaciones llamadas "%": los nombres tienen que ser distintos', v_etiqueta;
    END IF;

    v_padre_idx := NULLIF(v_linea->>'padre_idx', '')::int;
    IF v_padre_idx IS NULL THEN
      -- Sin padre = la base. Tiene que haber exactamente una y su factor tiene que ser 1.
      v_bases := v_bases + 1;
      IF v_factor <> 1 THEN
        RAISE EXCEPTION 'La presentación base ("%") tiene que equivaler a 1 unidad', v_etiqueta;
      END IF;
    ELSE
      -- El padre siempre es una línea ANTERIOR → el árbol no puede tener ciclos por construcción.
      IF v_padre_idx < 0 OR v_padre_idx >= v_i THEN
        RAISE EXCEPTION '"%" tiene que colgar de una presentación más chica ya definida', v_etiqueta;
      END IF;
      v_factor_padre := NULLIF((p_lineas -> v_padre_idx)->>'factor_base','')::bigint;
      IF v_factor <= v_factor_padre THEN
        RAISE EXCEPTION '"%" (% u) tiene que ser MÁS GRANDE que la presentación de la que cuelga (% u)',
          v_etiqueta, v_factor, v_factor_padre;
      END IF;
      -- Un empaque contiene un número ENTERO de su empaque hijo (3 cajas y media no existe).
      IF v_factor % v_factor_padre <> 0 THEN
        RAISE EXCEPTION '"%" (% u) tiene que contener un número entero de "%" (% u)',
          v_etiqueta, v_factor, COALESCE((p_lineas -> v_padre_idx)->>'etiqueta','—'), v_factor_padre;
      END IF;
    END IF;

    v_empaque := NULLIF(v_linea->>'nombre_empaque_id','')::uuid;
    IF v_empaque IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM unidades_medida WHERE id = v_empaque AND tenant_id = v_caller_tenant
    ) THEN
      RAISE EXCEPTION 'El nombre de empaque de "%" no es válido', v_etiqueta;
    END IF;
  END LOOP;

  IF v_bases <> 1 THEN
    RAISE EXCEPTION 'Tiene que haber exactamente UNA presentación base (la de 1 unidad)';
  END IF;

  -- ── Persistir (reemplazo total; nada referencia a producto_presentaciones por FK) ──
  DELETE FROM producto_presentaciones WHERE producto_id = p_producto_id;

  v_ids := ARRAY[]::uuid[];
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_linea     := p_lineas -> v_i;
    v_padre_idx := NULLIF(v_linea->>'padre_idx', '')::int;
    v_nueva_id  := gen_random_uuid();

    INSERT INTO producto_presentaciones
      (id, tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
       padre_linea_id, orden, activo, peso_kg, alto_cm, ancho_cm, largo_cm)
    VALUES (
      v_nueva_id, v_caller_tenant, p_producto_id,
      NULLIF(v_linea->>'nombre_empaque_id','')::uuid,
      btrim(v_linea->>'etiqueta'),
      (v_linea->>'factor_base')::bigint,
      v_padre_idx IS NULL,
      CASE WHEN v_padre_idx IS NULL THEN NULL ELSE v_ids[v_padre_idx + 1] END,
      v_i, COALESCE((v_linea->>'activo')::boolean, true),
      NULLIF(v_linea->>'peso_kg','')::numeric,
      NULLIF(v_linea->>'alto_cm','')::numeric,
      NULLIF(v_linea->>'ancho_cm','')::numeric,
      NULLIF(v_linea->>'largo_cm','')::numeric
    );

    v_ids := v_ids || v_nueva_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_presentaciones_guardar(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_presentaciones_guardar(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_presentaciones_guardar(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_presentaciones_guardar(uuid, jsonb) IS
  'Fase 5 del rediseño UoM: guarda el árbol de presentaciones de un producto (reemplazo total). Reemplaza a fn_estructura_guardar_niveles. El padre se referencia por índice anterior del array → no puede haber ciclos. Valida: una sola base con factor 1, etiquetas únicas, hijo más grande que el padre y múltiplo entero.';

-- ── 4-bis) La presentación BASE se siembra sola ──────────────────────────────────────────
-- El backfill de arriba cubre los productos que YA existen. Sin esto, un producto dado de alta
-- DESPUÉS de la migración quedaría con cero presentaciones (el selector de UoM del POS y de
-- recepción no tendría de dónde leer). Además mantiene H2: la etiqueta de la base sigue al campo
-- "Unidad de medida" de la ficha, que es su única fuente.
CREATE OR REPLACE FUNCTION public.trg_producto_sembrar_presentacion_base()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- el alta de producto puede venir de flujos que no ven la tabla por RLS
SET search_path = public
AS $$
DECLARE
  v_etiqueta text := COALESCE(NULLIF(btrim(NEW.unidad_medida), ''), 'Unidad');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO producto_presentaciones
      (tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
       padre_linea_id, orden, activo)
    VALUES (NEW.tenant_id, NEW.id, NULL, v_etiqueta, 1, true, NULL, 0, true)
    ON CONFLICT DO NOTHING;   -- si el alta ya creó sus presentaciones, no la duplicamos
    RETURN NEW;
  END IF;

  -- UPDATE de la unidad de medida: renombrar la base (H2). Si la etiqueta nueva choca con otra
  -- presentación del producto se deja como está — el nombre lo resuelve el usuario en el editor;
  -- no vale romperle el guardado de la ficha por un conflicto de etiqueta de empaque.
  UPDATE producto_presentaciones pp
    SET etiqueta = v_etiqueta
  WHERE pp.producto_id = NEW.id AND pp.es_base
    AND pp.etiqueta IS DISTINCT FROM v_etiqueta
    AND NOT EXISTS (
      SELECT 1 FROM producto_presentaciones otra
      WHERE otra.producto_id = NEW.id AND otra.id <> pp.id AND otra.etiqueta = v_etiqueta
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_presentacion_base ON productos;
CREATE TRIGGER trg_productos_presentacion_base
  AFTER INSERT OR UPDATE OF unidad_medida ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_producto_sembrar_presentacion_base();

-- ── 5) Deprecación (NO se dropean: inventario_lineas.estructura_id las referencia) ────────
COMMENT ON TABLE producto_estructuras IS
  'DEPRECADA (mig 310) — reemplazada por producto_presentaciones, que pasó a ser la fuente de verdad del empaque. Se conserva porque inventario_lineas.estructura_id la referencia como histórico de recepción (borrarla sería perder trazabilidad). No se escribe más desde la app.';
COMMENT ON TABLE producto_estructura_niveles IS
  'DEPRECADA (mig 310) — su cadena lineal no puede expresar presentaciones hermanas (Caja-12 y Caja-10 del mismo producto). Migrada a producto_presentaciones (árbol genealógico). Solo lectura histórica.';

-- La presentación base tiene que existir siempre: la crea el backfill y la exige
-- fn_presentaciones_guardar. Documentado en la tabla.
COMMENT ON TABLE producto_presentaciones IS
  'FUENTE DE VERDAD del empaque de un producto (mig 310). Árbol genealógico: cada línea cuelga de una más chica (padre_linea_id) y guarda su equivalencia RESUELTA en unidades base (factor_base). Admite HERMANAS (Caja-12 y Caja-10 del mismo producto). Sin precio propio: el empaque es logística pura (mig 307); el precio vive en la unidad base + tiers (mig 306). Se escribe SOLO vía fn_presentaciones_guardar; la base la siembra trg_productos_presentacion_base. Reemplaza a producto_estructuras/_niveles (deprecadas).';

COMMENT ON COLUMN producto_presentaciones.es_base IS
  'TRUE en la única presentación de factor 1 (la unidad base de la ficha). Es la raíz del árbol: padre_linea_id NULL. Toda cantidad de stock se guarda en ESTA unidad.';
