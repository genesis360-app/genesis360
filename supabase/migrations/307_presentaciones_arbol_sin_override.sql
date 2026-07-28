-- ============================================================
-- 307_presentaciones_arbol_sin_override.sql
-- FASE 2-bis CHUNK 2 del rediseño UoM/Empaque/Variantes.
-- Reencauza la mig 304 con las RESPUESTAS FINALES de Fede (2026-07-24):
--
--   (A) 🛑 EMPAQUE = LOGÍSTICA PURA, SIN PRECIO PROPIO (Regla de Oro #0, TOCA PLATA).
--       Se ELIMINAN los overrides de precio de presentación/nivel. A partir de acá el precio de
--       una presentación es SIEMPRE `productos.precio_venta (por unidad base) × factor_base`.
--       El "precio por bulto/volumen" ya NO vive en el empaque: se expresa con un TIER de
--       cantidad (mig 306, producto_precios_mayorista). Vender "2 cajas" en el POS queda como
--       CONVERSIÓN DE CANTIDAD (2 × factor_base unidades base), nunca como un precio de bulto.
--       Columnas dropeadas: producto_presentaciones.{precio_venta,precio_costo} y
--       producto_estructura_niveles.{precio_venta,precio_costo} (mig 286/287, ya sin uso).
--
--   (B) EMPAQUE = ÁRBOL GENEALÓGICO. Cada presentación apunta EXPLÍCITO a su padre
--       (`padre_linea_id`); el `factor_base` sigue resuelto y GUARDADO (unidades base por 1 de
--       esta presentación). En Fase 2-bis los niveles siguen siendo una cadena lineal (hermanas
--       bloqueadas hasta Fase 5), así que el padre de cada presentación = la del nivel de orden
--       inmediatamente menor; la base tiene padre NULL. Guards:
--         · borrado-con-hijos: FK self NO ACTION → no se puede borrar una presentación mientras
--           otra la referencia como padre (el rebuild borra todo el producto en 1 statement, que
--           NO ACTION difiere al final → pasa; borrar UNA fila padre suelta con hijos → falla).
--         · sin ciclos: trigger trg_pp_no_ciclo (defensa para cuando la tabla sea editable en Fase 5).
--
--   (C) H2 — el nivel BASE de la Estructura DERIVA del campo "Unidad de medida" de la ficha
--       (`productos.unidad_medida`, sincronizado con la UdM física en Fase 1) — una dirección.
--       La etiqueta de la presentación base pasa a mostrar la UdM de la ficha, no un nombre de
--       empaque elegido aparte.
--
-- producto_presentaciones sigue siendo 100% DERIVADA de la estructura default (la reconstruye
-- fn_rebuild_presentaciones vía trigger). authenticated solo LEE. NO toca stock/movimientos/fiscal.
-- El back-calc de plata ya lo hizo mig 304 (precio en base); acá solo se descartan overrides:
-- el precio efectivo de un bulto pasa a ser exacto = base × factor (verificado en DEV: los 22
-- productos con override eran E2E/Test salvo Coca 2.5L, cuyo override 3500 vs 6×583.33=3499.98
-- difería 2 centavos por redondeo del precio/unidad — consecuencia esperada del modelo de Fede).
-- ============================================================

-- ── 1) Árbol genealógico: padre_linea_id (self-FK, NO ACTION = guard de borrado-con-hijos) ──
ALTER TABLE producto_presentaciones
  ADD COLUMN IF NOT EXISTS padre_linea_id uuid REFERENCES producto_presentaciones(id);

COMMENT ON COLUMN producto_presentaciones.padre_linea_id IS
  'Presentación padre en el árbol de empaque (NULL = base). factor_base ya viene resuelto a la unidad base. FK NO ACTION: no se puede borrar un padre con hijos (el rebuild borra el producto entero en 1 statement, que sí pasa).';

CREATE INDEX IF NOT EXISTS idx_pp_padre ON producto_presentaciones (padre_linea_id);
-- Defensa en profundidad: `orden` único por producto (hoy lo garantiza el único escritor
-- fn_rebuild_presentaciones; el linkeo del padre en 4b asume unicidad de orden).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_producto_orden ON producto_presentaciones (producto_id, orden);

-- ── 2) 🛑 Drop de los overrides de precio (empaque sin precio — decisión Fede) ──────────────
ALTER TABLE producto_presentaciones  DROP COLUMN IF EXISTS precio_venta;
ALTER TABLE producto_presentaciones  DROP COLUMN IF EXISTS precio_costo;
ALTER TABLE producto_estructura_niveles DROP COLUMN IF EXISTS precio_venta;
ALTER TABLE producto_estructura_niveles DROP COLUMN IF EXISTS precio_costo;

-- ── 3) Guard de ciclos (defensa para la edición directa de Fase 5) ──────────────────────────
-- Rechaza self-parent y cualquier cadena que vuelva sobre sí misma. En Fase 2-bis la tabla la
-- escribe solo fn_rebuild_presentaciones armando cadenas lineales (padre siempre de orden menor),
-- así que este trigger nunca dispara — es la red para cuando padre_linea_id sea editable.
CREATE OR REPLACE FUNCTION trg_pp_no_ciclo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cursor    uuid := NEW.padre_linea_id;
  v_hops      int  := 0;
  v_padre_prd uuid;
BEGIN
  IF NEW.padre_linea_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.padre_linea_id = NEW.id THEN
    RAISE EXCEPTION 'Una presentación no puede ser su propio padre';
  END IF;
  -- El padre debe ser del MISMO producto (defensa para la edición directa de Fase 5).
  SELECT producto_id INTO v_padre_prd FROM producto_presentaciones WHERE id = NEW.padre_linea_id;
  IF v_padre_prd IS NULL OR v_padre_prd <> NEW.producto_id THEN
    RAISE EXCEPTION 'El padre de una presentación debe pertenecer al mismo producto';
  END IF;
  WHILE v_cursor IS NOT NULL LOOP
    v_hops := v_hops + 1;
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'Ciclo en el árbol de presentaciones (padre_linea_id)';
    END IF;
    IF v_hops > 50 THEN
      RAISE EXCEPTION 'Cadena de presentaciones demasiado profunda (posible ciclo)';
    END IF;
    SELECT padre_linea_id INTO v_cursor FROM producto_presentaciones WHERE id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pp_no_ciclo ON producto_presentaciones;
CREATE TRIGGER trg_pp_no_ciclo
  BEFORE INSERT OR UPDATE OF padre_linea_id ON producto_presentaciones
  FOR EACH ROW EXECUTE FUNCTION trg_pp_no_ciclo();

-- ── 4) fn_rebuild_presentaciones — sin precio, con padre_linea_id + H2 (base ← UdM ficha) ───
CREATE OR REPLACE FUNCTION fn_rebuild_presentaciones(p_producto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_estr_id    uuid;
  v_min_orden  int;
  v_udm_ficha  text;
BEGIN
  SELECT tenant_id, NULLIF(trim(unidad_medida), '')
    INTO v_tenant_id, v_udm_ficha
    FROM productos WHERE id = p_producto_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_estr_id FROM producto_estructuras
    WHERE producto_id = p_producto_id AND is_default = true
    ORDER BY created_at LIMIT 1;

  DELETE FROM producto_presentaciones WHERE producto_id = p_producto_id;
  IF v_estr_id IS NULL THEN RETURN; END IF;

  SELECT min(orden) INTO v_min_orden FROM producto_estructura_niveles WHERE estructura_id = v_estr_id;
  IF v_min_orden IS NULL THEN RETURN; END IF;

  -- (a) insertar todas las presentaciones (padre NULL por ahora; sin precio)
  INSERT INTO producto_presentaciones
    (tenant_id, producto_id, nombre_empaque_id, etiqueta, factor_base, es_base,
     orden, activo, peso_kg, alto_cm, ancho_cm, largo_cm)
  SELECT
    v_tenant_id, p_producto_id, n.unidad_medida_id,
    -- H2: la base muestra la UdM de la ficha; los demás niveles su nombre de empaque.
    CASE WHEN n.orden = v_min_orden
         THEN COALESCE(v_udm_ficha, um.nombre, 'Unidad')
         ELSE COALESCE(um.nombre, 'Presentación ' || n.orden) END,
    n.unidades_base,
    (n.orden = v_min_orden),
    n.orden, true, n.peso_kg, n.alto_cm, n.ancho_cm, n.largo_cm
  FROM producto_estructura_niveles n
  LEFT JOIN unidades_medida um ON um.id = n.unidad_medida_id
  WHERE n.estructura_id = v_estr_id;

  -- (b) linkear cada presentación a la del orden inmediatamente menor (cadena lineal Fase 2-bis).
  --     La base (min orden) queda con padre NULL.
  UPDATE producto_presentaciones child
    SET padre_linea_id = parent.id
  FROM producto_presentaciones parent
  WHERE child.producto_id = p_producto_id
    AND parent.producto_id = p_producto_id
    AND parent.orden = (
      SELECT max(x.orden) FROM producto_presentaciones x
      WHERE x.producto_id = p_producto_id AND x.orden < child.orden
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_rebuild_presentaciones(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_rebuild_presentaciones(uuid) TO service_role;

-- ── 5) fn_estructura_guardar_niveles — sin el bloque de precio por nivel (columnas dropeadas) ─
-- Idéntica a la de mig 304 salvo que ya no INSERTA precio_venta/precio_costo ni los valida
-- (empaque sin precio). Si el frontend viejo manda esas claves en el jsonb, se ignoran. El
-- trigger trg_pp_sync_niveles rebuildea presentaciones tras el guardado.
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

-- ── 6) Backfill: reconstruir todas las presentaciones (setea etiqueta base H2 + padre_linea_id) ─
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT producto_id FROM producto_estructuras WHERE is_default = true LOOP
    PERFORM fn_rebuild_presentaciones(r.producto_id);
  END LOOP;
END $$;
