-- Fede 25/7, punto 1: el tier mayorista admite ahora "% de descuento" además de precio fijo, y un
-- enlace OPCIONAL a una línea puntual del árbol de empaque (producto_presentaciones), por
-- IDENTIDAD de línea (no por nombre libre). Si está enlazado, el tier se evalúa contra la cantidad
-- de PALLETS/CAJAS completos (cantidad_total_sku / factor_base de esa línea), no contra unidades
-- sueltas — así el descuento aplica para cualquier múltiplo exacto (1, 2, 3 pallets…) sin tener
-- que cargar un tier por cada múltiplo posible.
--
-- Sigue alineado con mig 307 (el empaque no tiene precio propio): esto no le agrega precio a
-- `producto_presentaciones`, solo la referencia desde el tier — la línea de empaque sigue siendo
-- 100% logística.

ALTER TABLE public.producto_precios_mayorista
  ADD COLUMN IF NOT EXISTS tipo_valor text NOT NULL DEFAULT 'precio_fijo',
  ADD COLUMN IF NOT EXISTS presentacion_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producto_precios_mayorista_tipo_valor_chk') THEN
    ALTER TABLE public.producto_precios_mayorista
      ADD CONSTRAINT producto_precios_mayorista_tipo_valor_chk
      CHECK (tipo_valor = ANY (ARRAY['precio_fijo'::text, 'pct'::text]));
  END IF;
END $$;

-- % de descuento: 0-100. El precio fijo sigue validado por el CHECK existente (>= 0).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producto_precios_mayorista_precio_pct_chk') THEN
    ALTER TABLE public.producto_precios_mayorista
      ADD CONSTRAINT producto_precios_mayorista_precio_pct_chk
      CHECK (tipo_valor <> 'pct' OR (precio >= 0 AND precio <= 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producto_precios_mayorista_presentacion_id_fkey') THEN
    ALTER TABLE public.producto_precios_mayorista
      ADD CONSTRAINT producto_precios_mayorista_presentacion_id_fkey
      FOREIGN KEY (presentacion_id) REFERENCES producto_presentaciones(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ppm_presentacion ON public.producto_precios_mayorista USING btree (presentacion_id);

COMMENT ON COLUMN public.producto_precios_mayorista.tipo_valor IS
  'precio_fijo (default, legacy) = producto_precios_mayorista.precio es $/unidad. pct = precio es % de descuento sobre productos.precio_venta (NUNCA sobre un precio ya rebajado).';
COMMENT ON COLUMN public.producto_precios_mayorista.presentacion_id IS
  'Enlace opcional a una línea de producto_presentaciones. Si está seteado, cantidad_minima se compara contra la cantidad de MÚLTIPLOS COMPLETOS de esa presentación (no unidades sueltas) — el descuento se multiplica automático para 1, 2, 3… pallets. NULL = tier normal por cantidad de unidades.';

-- Guard: el FK por sí solo no impide enlazar la línea de empaque de OTRO producto (o, ya que los
-- checks de FK no pasan por RLS, hasta de otro tenant). RLS protege filas, no relaciones cruzadas
-- entre tablas — sin este trigger, un tier de "Producto A" podría apuntar a la presentación de
-- "Producto B" y el multiplicador de cantidad quedaría calculado contra el factor_base equivocado.
CREATE OR REPLACE FUNCTION public.trg_ppm_presentacion_mismo_producto()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.presentacion_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM producto_presentaciones pp
      WHERE pp.id = NEW.presentacion_id
        AND pp.producto_id = NEW.producto_id
        AND pp.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'La presentación enlazada no pertenece a este producto';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ppm_presentacion_mismo_producto ON public.producto_precios_mayorista;
CREATE TRIGGER trg_ppm_presentacion_mismo_producto
  BEFORE INSERT OR UPDATE OF presentacion_id, producto_id ON public.producto_precios_mayorista
  FOR EACH ROW EXECUTE FUNCTION public.trg_ppm_presentacion_mismo_producto();
