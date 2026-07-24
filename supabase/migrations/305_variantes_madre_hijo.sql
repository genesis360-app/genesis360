-- ============================================================
-- 305_variantes_madre_hijo.sql
-- FASE 3 del rediseño UoM/Empaque/Variantes (ver diseño-uom-empaque-variantes.html §2/§7).
--
-- Formaliza las variantes con auto-referencia en `productos` (estilo Shopify: el producto ES
-- el padre), reemplazando `producto_grupos` (mig 120). Decisión Eje A de GO: "atributos de
-- variante" a nivel LPN (talle/color, mig 274) COEXISTE — no se depreca.
--
--  · productos.producto_padre_id  NULL = madre/standalone · con valor = hijo de esa madre.
--  · productos.variante_diferenciador  el valor que distingue al hijo ("Rojo / M"), único
--    entre hermanos de la misma madre.
--  · El NOMBRE vive en la madre. El hijo lleva `madre.nombre — diferenciador`, mantenido por
--    trigger (BEFORE) al insertar/editar el hijo y (AFTER) al cambiar el nombre de la madre —
--    así todo consumidor (ticket, factura, búsqueda) sigue leyendo productos.nombre sin cambios.
--  · Una madre CON hijos es agrupador (no vendible) — se DERIVA (EXISTS hijos), sin flag nuevo.
--  · Solo 2 niveles: un hijo no puede ser padre de otro (guard en trigger).
--
-- NO toca stock (los grupos migrados ya tenían el stock EN LOS PRODUCTOS, que pasan a ser hijos;
-- la madre nace en 0). La migración de stock "sin variante asignada" al crear la PRIMERA variante
-- de un producto standalone con stock + los guards de borrado multi-sucursal son la FASE 4.
-- ============================================================

-- ── 1) Columnas ─────────────────────────────────────────────────────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS producto_padre_id     uuid REFERENCES productos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variante_diferenciador text;

COMMENT ON COLUMN productos.producto_padre_id IS
  'Variante madre/hijo (rediseño UoM Fase 3): NULL = madre o producto standalone; con valor = hijo de esa madre. Reemplaza producto_grupos.grupo_id.';
COMMENT ON COLUMN productos.variante_diferenciador IS
  'Valor que distingue al hijo entre sus hermanos ("Rojo / M"). Único por (producto_padre_id). El nombre del hijo = madre.nombre — diferenciador (mantenido por trigger).';

CREATE INDEX IF NOT EXISTS idx_productos_padre ON productos (producto_padre_id) WHERE producto_padre_id IS NOT NULL;

-- Diferenciador único entre hermanos
CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_variante_unica
  ON productos (producto_padre_id, variante_diferenciador)
  WHERE producto_padre_id IS NOT NULL;

-- Un hijo SIEMPRE tiene diferenciador; nadie se referencia a sí mismo como padre.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_hijo_tiene_diferenciador') THEN
    ALTER TABLE productos ADD CONSTRAINT productos_hijo_tiene_diferenciador
      CHECK (producto_padre_id IS NULL OR variante_diferenciador IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_padre_no_self') THEN
    ALTER TABLE productos ADD CONSTRAINT productos_padre_no_self
      CHECK (producto_padre_id IS NULL OR producto_padre_id <> id);
  END IF;
END $$;

-- ── 2) Trigger BEFORE: componer el nombre del hijo + guard de 2 niveles ─────────────────
CREATE OR REPLACE FUNCTION trg_variante_compose_nombre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_madre_nombre text;
  v_madre_padre  uuid;
  v_madre_tenant uuid;
BEGIN
  IF NEW.producto_padre_id IS NULL THEN
    RETURN NEW;  -- madre/standalone: el nombre es el que se cargó tal cual
  END IF;

  -- El padre debe existir, ser del mismo tenant y NO ser a su vez un hijo (solo 2 niveles).
  -- Chequeo explícito de tenant además del RLS (defensa en profundidad: los flujos service_role
  -- —EF, importador masivo— bypassean RLS, y no queremos cross-linkear variantes de otro tenant).
  SELECT nombre, producto_padre_id, tenant_id INTO v_madre_nombre, v_madre_padre, v_madre_tenant
  FROM productos WHERE id = NEW.producto_padre_id;
  IF v_madre_nombre IS NULL THEN
    RAISE EXCEPTION 'La madre % no existe', NEW.producto_padre_id;
  END IF;
  IF v_madre_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'La madre pertenece a otro tenant';
  END IF;
  IF v_madre_padre IS NOT NULL THEN
    RAISE EXCEPTION 'Una variante no puede colgar de otra variante (solo 2 niveles: madre → hijo)';
  END IF;
  -- Y este producto no puede volverse hijo si YA es madre de otros (cerraría 3 niveles).
  IF EXISTS (SELECT 1 FROM productos WHERE producto_padre_id = NEW.id) THEN
    RAISE EXCEPTION 'Este producto ya tiene variantes propias; no puede convertirse en hijo de otro';
  END IF;

  -- Nombre compuesto: madre — diferenciador (fuente única para todo consumidor de productos.nombre)
  NEW.nombre := v_madre_nombre || ' — ' || NEW.variante_diferenciador;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_compose_nombre ON productos;
CREATE TRIGGER trg_productos_compose_nombre
  BEFORE INSERT OR UPDATE OF producto_padre_id, variante_diferenciador, nombre ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_variante_compose_nombre();

-- ── 3) Trigger AFTER: propagar el nombre de la madre a sus hijos ─────────────────────────
CREATE OR REPLACE FUNCTION trg_variante_propagar_nombre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo una madre/standalone que cambió de nombre. El UPDATE dispara el BEFORE de cada hijo,
  -- que recompone su nombre desde este nuevo valor (idempotente, sin recursión: los hijos no
  -- tienen hijos). Se filtra por cambio real de nombre para no reescribir en cascada de más.
  IF NEW.producto_padre_id IS NULL AND NEW.nombre IS DISTINCT FROM OLD.nombre THEN
    UPDATE productos
      SET nombre = NEW.nombre || ' — ' || variante_diferenciador
      WHERE producto_padre_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_productos_propagar_nombre ON productos;
CREATE TRIGGER trg_productos_propagar_nombre
  AFTER UPDATE OF nombre ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_variante_propagar_nombre();

-- ── 4) Migración de datos: producto_grupos con ≥2 productos → madre + hijos ──────────────
-- Los grupos con 1 solo producto no son variantes reales → ese producto queda standalone.
-- Los grupos vacíos se ignoran. El diferenciador sale de variante_valores (join de valores
-- no vacíos) o, si no hay, del nombre del producto sin el prefijo del grupo; se garantiza único
-- entre hermanos (colisión → se sufija el sku). El nombre del hijo lo compone el trigger BEFORE.
DO $$
DECLARE
  g          RECORD;
  pr         RECORD;
  v_madre_id uuid;
  v_madre_sku text;
  v_dif      text;
  v_dif_base text;
  v_i        int;
BEGIN
  FOR g IN
    -- producto_padre_id IS NULL = aún no migrado → idempotente: en una 2da corrida los hijos ya
    -- tienen padre y no se cuentan, así que el grupo no se re-procesa (no duplica madres).
    SELECT gr.id, gr.tenant_id, gr.nombre, gr.categoria_id
    FROM producto_grupos gr
    WHERE (SELECT count(*) FROM productos p
           WHERE p.grupo_id = gr.id AND p.producto_padre_id IS NULL) >= 2
  LOOP
    -- SKU único de la madre (agrupador). VAR- + 10 hex del id del grupo; si colisiona, sufijo.
    v_madre_sku := 'VAR-' || upper(substr(replace(g.id::text, '-', ''), 1, 10));
    v_i := 0;
    WHILE EXISTS (SELECT 1 FROM productos WHERE tenant_id = g.tenant_id AND sku = v_madre_sku) LOOP
      v_i := v_i + 1;
      v_madre_sku := 'VAR-' || upper(substr(replace(g.id::text, '-', ''), 1, 10)) || '-' || v_i;
    END LOOP;

    v_madre_id := gen_random_uuid();
    INSERT INTO productos (id, tenant_id, nombre, sku, categoria_id, precio_venta, precio_costo,
                           unidad_medida, activo, producto_padre_id, variante_diferenciador)
    VALUES (v_madre_id, g.tenant_id, g.nombre, v_madre_sku, g.categoria_id, 0, 0,
            'unidad', true, NULL, NULL);

    -- Cada producto del grupo pasa a ser hijo de la madre (los ya migrados se saltean).
    FOR pr IN
      SELECT p.id, p.nombre, p.sku, p.variante_valores
      FROM productos p WHERE p.grupo_id = g.id AND p.producto_padre_id IS NULL
      ORDER BY p.nombre
    LOOP
      -- (a) diferenciador desde variante_valores (valores no vacíos, ordenados por clave)
      v_dif_base := (
        SELECT string_agg(value, ' / ' ORDER BY key)
        FROM jsonb_each_text(COALESCE(pr.variante_valores, '{}'::jsonb))
        WHERE value IS NOT NULL AND btrim(value) <> ''
      );
      -- (b) fallback: nombre del producto sin el prefijo del grupo (anclado al inicio,
      -- case-insensitive) y sin separadores sueltos. Solo recorta si es realmente prefijo.
      IF v_dif_base IS NULL OR btrim(v_dif_base) = '' THEN
        IF lower(pr.nombre) LIKE lower(g.nombre) || '%' THEN
          v_dif_base := trim(both ' —-' from substr(pr.nombre, length(g.nombre) + 1));
        ELSE
          v_dif_base := pr.nombre;
        END IF;
      END IF;
      -- (c) último recurso: el sku
      IF v_dif_base IS NULL OR btrim(v_dif_base) = '' THEN
        v_dif_base := pr.sku;
      END IF;

      -- Unicidad entre hermanos ya asignados
      v_dif := v_dif_base;
      IF EXISTS (SELECT 1 FROM productos WHERE producto_padre_id = v_madre_id AND variante_diferenciador = v_dif) THEN
        v_dif := v_dif_base || ' (' || pr.sku || ')';
      END IF;

      -- Setea padre + diferenciador; el trigger BEFORE compone el nombre.
      UPDATE productos
        SET producto_padre_id = v_madre_id, variante_diferenciador = v_dif
        WHERE id = pr.id;
    END LOOP;
  END LOOP;
END $$;

-- ── 5) Deprecar producto_grupos / grupo_id / variante_valores (se dropean en limpieza futura) ─
COMMENT ON COLUMN productos.grupo_id IS
  'DEPRECADA (mig 305) — reemplazada por productos.producto_padre_id (variantes madre/hijo). Se mantiene hasta la limpieza de fase posterior.';
COMMENT ON COLUMN productos.variante_valores IS
  'DEPRECADA (mig 305) — reemplazada por productos.variante_diferenciador. Se mantiene hasta la limpieza de fase posterior.';
COMMENT ON TABLE producto_grupos IS
  'DEPRECADA (mig 305) — reemplazada por auto-referencia productos.producto_padre_id. Se mantiene hasta la limpieza de fase posterior.';
