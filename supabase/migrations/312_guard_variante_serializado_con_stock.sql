-- ============================================================
-- 312_guard_variante_serializado_con_stock.sql
-- 🛑 REGLA #0 (INVENTARIO) — cierra un hueco abierto por la mig 309 (Fase 4).
--
-- La Fase 4 DESBLOQUEÓ crear la primera variante de un producto con stock: ese stock queda
-- "sin variante asignada" (contable pero no vendible) y se reparte después con
-- `fn_reasignar_stock_variante`.
--
-- PERO esa RPC RECHAZA los productos con número de serie: repartir "6 y 4" sin decir QUÉ serie
-- va a cada variante rompería la trazabilidad (cada serie es una unidad física identificada), y
-- la pantalla para elegir series todavía no existe.
--
-- Combinando las dos cosas quedaba una TRAMPA: convertir un producto SERIALIZADO con stock en
-- agrupador dejaba ese stock atrapado — no vendible (la madre con hijos no se vende) y no
-- reasignable (la RPC lo rechaza). Sin salida desde la app.
--
-- Este guard lo impide en el SERVIDOR (la UI se cachea / se puede bypassear, y el importador y
-- las Edge Functions escriben con service_role sin pasar por la UI). Solo bloquea el caso exacto
-- que no tiene solución: convertir en madre un producto SERIALIZADO CON STOCK. Agregar una
-- variante más a una madre que YA tiene hijos no se toca.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_variante_compose_nombre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_madre_nombre text;
  v_madre_padre  uuid;
  v_madre_tenant uuid;
  v_madre_series boolean;
  v_madre_stock  integer;
BEGIN
  IF NEW.producto_padre_id IS NULL THEN
    RETURN NEW;  -- madre/standalone: el nombre es el que se cargó tal cual
  END IF;

  -- El padre debe existir, ser del mismo tenant y NO ser a su vez un hijo (solo 2 niveles).
  -- Chequeo explícito de tenant además del RLS (defensa en profundidad: los flujos service_role
  -- —EF, importador masivo— bypassean RLS, y no queremos cross-linkear variantes de otro tenant).
  SELECT nombre, producto_padre_id, tenant_id, COALESCE(tiene_series, false), COALESCE(stock_actual, 0)
    INTO v_madre_nombre, v_madre_padre, v_madre_tenant, v_madre_series, v_madre_stock
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

  -- 🛑 Guard nuevo (mig 312): serializado + stock + primera variante = stock atrapado.
  -- Solo aplica al momento de CONVERTIR en agrupador (la madre todavía no tiene hijos): agregarle
  -- otra variante a una madre que ya es agrupador no empeora nada.
  IF v_madre_series AND v_madre_stock <> 0
     AND NOT EXISTS (
       SELECT 1 FROM productos h
       WHERE h.producto_padre_id = NEW.producto_padre_id AND h.id IS DISTINCT FROM NEW.id
     )
  THEN
    RAISE EXCEPTION 'No se puede convertir "%" en agrupador de variantes: lleva número de serie y tiene % unidad(es) de stock. Repartir stock serializado exige elegir qué serie va a cada variante y esa pantalla todavía no existe, así que el stock quedaría sin poder venderse ni reasignarse. Dejá el stock en 0 primero.',
      v_madre_nombre, v_madre_stock;
  END IF;

  -- Nombre compuesto: madre — diferenciador (fuente única para todo consumidor de productos.nombre)
  NEW.nombre := v_madre_nombre || ' — ' || NEW.variante_diferenciador;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_variante_compose_nombre() IS
  'Compone el nombre del hijo (madre — diferenciador) y guarda las reglas de variantes: mismo tenant, solo 2 niveles, y (mig 312) no convertir en agrupador un producto SERIALIZADO CON STOCK, porque ese stock quedaría sin poder venderse ni reasignarse.';
