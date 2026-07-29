-- ============================================================
-- 314_guard_variante_atributos_incompatibles.sql
-- 🛑 REGLA #0 (INVENTARIO) — reconstruye, sobre el modelo madre/hijo, el guard que la mig 274
-- tenía sobre `grupo_id` y que se perdió al dropear esa columna en la mig 311.
--
-- Dos modelos de variante, incompatibles DENTRO de un mismo producto:
--   · Variantes madre/hijo (`producto_padre_id`, mig 305): cada variante es un SKU/producto
--     SEPARADO, con su propio `stock_actual`, precio y código de barras.
--   · Atributos de variante (`tiene_talle`/`tiene_color`/…, mig 274): UN SOLO SKU cuyas
--     `inventario_lineas` llevan el atributo — el stock se banca junto y se distingue en el
--     depósito (te lo pide en cada ingreso y en cada venta).
--
-- Decisión de GO (2026-07-28): los dos sistemas COEXISTEN en la app (Eje A) pero NO dentro del
-- mismo producto — cada producto usa uno u otro.
--
-- ⚠ Nota para quien lea esto en el futuro: la razón técnica que motivó la mig 274 ("el ingreso no
-- pedía el talle porque la UI de Grupo de variantes no lo exige de esa forma") YA NO APLICA en el
-- modelo madre/hijo: un hijo es un producto normal (el POS sólo excluye a las MADRES, y el ingreso
-- lee `tiene_talle` genéricamente del producto). Hoy este guard es una decisión de MODELO, no una
-- limitación técnica. Si algún día se quiere el híbrido "color = SKU separado, talle = atributo de
-- LPN" (caso real en indumentaria), alcanza con dropear el CHECK y el trigger de esta migración.
--
-- Verificado ANTES de aplicar (query sobre datos REALES, 2026-07-28):
--   · DEV  — 404 productos · 42 hijos · 17 madres · 65 con atributos → 0 hijos y 0 madres en violación.
--   · PROD —  23 productos ·  0 hijos ·  0 madres ·  1 con atributos → 0 hijos y 0 madres en violación.
-- No hay filas que corregir: el guard entra sin tocar un solo dato.
-- ============================================================

-- ── 1) El HIJO no puede tener atributos de variante propios ──────────────────────────────
-- CHECK y no trigger: es table-local (no necesita mirar otras filas), es la garantía DURA — se
-- valida siempre, en cualquier camino de escritura, y no se puede desactivar como un trigger.
-- Las 5 columnas son NOT NULL DEFAULT false, así que no hace falta COALESCE.
ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_productos_variante_sin_atributos;
ALTER TABLE productos ADD CONSTRAINT chk_productos_variante_sin_atributos
  CHECK (NOT (
    producto_padre_id IS NOT NULL
    AND (tiene_talle OR tiene_color OR tiene_encaje OR tiene_formato OR tiene_sabor_aroma)
  ));

COMMENT ON CONSTRAINT chk_productos_variante_sin_atributos ON productos IS
  'Una variante hijo (producto_padre_id) no puede tener además Atributos de variante activos — son dos modelos de stock incompatibles en el mismo SKU. Reemplaza a chk_productos_grupo_sin_atributos_variante (mig 274), perdido al dropear grupo_id en la mig 311. Ver mig 314 / wiki/features/atributos-variante.md.';

-- ── 2) El lado que el CHECK no puede ver: la MADRE ───────────────────────────────────────
-- Un CHECK es table-local, así que no puede preguntar "¿este producto tiene hijos?". Eso va por
-- trigger. Cubre los dos caminos que el CHECK deja abiertos:
--   (b) crear la PRIMERA variante de un producto que tiene atributos activos (lo convertiría en
--       agrupador con atributos), y
--   (c) encender un atributo en un producto que YA es agrupador.
-- Además adelanta el caso (a) del CHECK con un mensaje explicando el motivo, en vez del
-- "violates check constraint chk_..." crudo de Postgres.
--
-- SECURITY DEFINER a propósito: un guard NUNCA puede fallar ABIERTO. Con SECURITY INVOKER, si la
-- RLS le escondiera la fila de la madre al usuario, el SELECT no encontraría nada y el guard
-- pasaría de largo. Los dos SELECT filtran por `NEW.tenant_id`, así que saltear la RLS no expone
-- ni deja tocar datos de otro tenant (y el nombre que sale en el mensaje es siempre del propio).
CREATE OR REPLACE FUNCTION public.trg_variante_atributos_incompatibles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_madre_nombre text;
  v_hijos        integer;
BEGIN
  IF NEW.producto_padre_id IS NOT NULL THEN
    -- (a) El hijo con atributos propios. Lo garantiza el CHECK; acá se adelanta para dar el motivo.
    --     Se usa el diferenciador y no NEW.nombre porque el nombre compuesto lo escribe otro
    --     trigger BEFORE (trg_productos_compose_nombre) y no queremos depender del orden.
    IF NEW.tiene_talle OR NEW.tiene_color OR NEW.tiene_encaje OR NEW.tiene_formato OR NEW.tiene_sabor_aroma THEN
      RAISE EXCEPTION 'La variante "%" no puede tener Atributos de variante (talle/color/encaje/formato/sabor) activos: ya es un SKU separado con su propio stock. Los Atributos de variante son para UN SOLO SKU cuyo stock se banca junto.',
        COALESCE(NEW.variante_diferenciador, NEW.nombre);
    END IF;

    -- (b) La madre tiene atributos → crearle esta variante la convertiría en agrupador con atributos.
    SELECT nombre INTO v_madre_nombre
      FROM productos
     WHERE id = NEW.producto_padre_id
       AND tenant_id = NEW.tenant_id
       AND (tiene_talle OR tiene_color OR tiene_encaje OR tiene_formato OR tiene_sabor_aroma);
    IF FOUND THEN
      RAISE EXCEPTION 'No se puede crear la variante: "%" tiene Atributos de variante (talle/color/encaje/formato/sabor) activos, y son dos modelos de stock incompatibles. Apagá los Atributos de variante en la ficha de "%" y después creale las variantes.',
        v_madre_nombre, v_madre_nombre;
    END IF;

    RETURN NEW;
  END IF;

  -- (c) Madre/standalone: no se puede encender un atributo si ya tiene variantes colgando.
  --     El EXISTS sólo corre si hay algún atributo prendido (short-circuit), así que apagarlos o
  --     guardar un producto sin atributos no paga nada.
  IF NEW.tiene_talle OR NEW.tiene_color OR NEW.tiene_encaje OR NEW.tiene_formato OR NEW.tiene_sabor_aroma THEN
    SELECT count(*) INTO v_hijos
      FROM productos
     WHERE producto_padre_id = NEW.id
       AND tenant_id = NEW.tenant_id;
    IF v_hijos > 0 THEN
      RAISE EXCEPTION 'No se pueden activar los Atributos de variante en "%": ya es un agrupador con % variante(s), y cada variante es un SKU separado con su propio stock. Son dos modelos incompatibles.',
        NEW.nombre, v_hijos;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_variante_atributos_incompatibles() IS
  'Guard de modelo de variantes (mig 314): un producto usa madre/hijo O Atributos de variante, nunca los dos. Cubre el lado que el CHECK no puede ver (¿tiene hijos?) y da el mensaje explicando el motivo.';

-- `UPDATE OF <cols>` acota el disparo a los saves que tocan esas columnas: recalcular_stock,
-- la propagación de nombre a los hijos y el resto de los UPDATE sobre productos no lo despiertan.
DROP TRIGGER IF EXISTS trg_productos_variante_atributos ON productos;
CREATE TRIGGER trg_productos_variante_atributos
  BEFORE INSERT OR UPDATE OF producto_padre_id, tiene_talle, tiene_color, tiene_encaje, tiene_formato, tiene_sabor_aroma
  ON productos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_variante_atributos_incompatibles();
