-- 466 — Categorías de clientes, Fase 4 parte A: la LISTA de descuentos por categoría (sin aplicarla todavía)
--
-- Decisión de GO 2026-10-02: (A) hoy, la lista y su carga; (B2) después, el motor único de precio y que el POS/Pedidos
-- la apliquen (gana el precio más bajo frente al tier y al estado, tope acumulado sin salteo — PL-1 —, mecanismo
-- guardado por línea). Esta migración NO cambia ningún precio: nada la lee todavía al vender.
--
-- Reglas del relevamiento: % POR PRODUCTO (B5); "sin cargar" ≠ "0 % explícito" (C4) → sin fila = sin cargar, fila con 0
-- = sin descuento a propósito; importación por Excel por SKU, todo o nada, actualiza solo lo que trae (B-3); pensado
-- para ~10.000 productos por categoría (B-9). Permisos: los de "gestionar categorías" (E1, mig 442). Auditoría (F1):
-- cada cambio a mano queda en el historial de la categoría; una importación deja UNA entrada con el resumen.

CREATE TABLE IF NOT EXISTS public.categoria_cliente_descuentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  categoria_id  uuid NOT NULL REFERENCES public.categorias_cliente(id) ON DELETE CASCADE,
  producto_id   uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  descuento_pct numeric(5,2) NOT NULL CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  UNIQUE (categoria_id, producto_id)
);

CREATE INDEX IF NOT EXISTS categoria_cliente_descuentos_producto_idx ON public.categoria_cliente_descuentos (producto_id);
CREATE INDEX IF NOT EXISTS categoria_cliente_descuentos_tenant_idx ON public.categoria_cliente_descuentos (tenant_id);

COMMENT ON TABLE public.categoria_cliente_descuentos IS
  'Mig 466: % de descuento por producto de una categoría de clientes. Sin fila = sin cargar; 0 = sin descuento explícito. Todavía no se aplica al vender (Fase B2).';

-- La categoría y el producto tienen que ser del mismo negocio que la fila (la RLS no lo garantiza sola).
CREATE OR REPLACE FUNCTION public.fn_categoria_descuentos_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM categorias_cliente WHERE id = NEW.categoria_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La categoría no pertenece a este negocio' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM productos WHERE id = NEW.producto_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'El producto no pertenece a este negocio' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categoria_descuentos_guard ON public.categoria_cliente_descuentos;
CREATE TRIGGER trg_categoria_descuentos_guard
  BEFORE INSERT OR UPDATE ON public.categoria_cliente_descuentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_categoria_descuentos_guard();

-- Historial: cada cambio a mano. La importación lo apaga (g360.cat_desc_importando) y deja una sola entrada.
CREATE OR REPLACE FUNCTION public.fn_categoria_descuentos_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row  categoria_cliente_descuentos := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_cat  text;
  v_prod text;
BEGIN
  IF current_setting('g360.cat_desc_importando', true) = '1' THEN RETURN NULL; END IF;
  -- Borrado en cascada de la categoría o del producto: no hay nada que contar.
  SELECT nombre INTO v_cat FROM categorias_cliente WHERE id = v_row.categoria_id;
  IF v_cat IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sku, '') || ' ' || nombre INTO v_prod FROM productos WHERE id = v_row.producto_id;
  PERFORM fn_log_categoria(v_row.tenant_id, 'categoria_cliente', v_row.categoria_id, v_cat,
    CASE TG_OP WHEN 'INSERT' THEN 'crear' WHEN 'DELETE' THEN 'eliminar' ELSE 'editar' END,
    'descuento: ' || COALESCE(v_prod, v_row.producto_id::text),
    CASE WHEN TG_OP = 'INSERT' THEN 'sin cargar' ELSE OLD.descuento_pct::text || '%' END,
    CASE WHEN TG_OP = 'DELETE' THEN 'sin cargar' ELSE NEW.descuento_pct::text || '%' END);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_categoria_descuentos_auditar ON public.categoria_cliente_descuentos;
CREATE TRIGGER trg_categoria_descuentos_auditar
  AFTER INSERT OR UPDATE OF descuento_pct OR DELETE ON public.categoria_cliente_descuentos
  FOR EACH ROW EXECUTE FUNCTION public.fn_categoria_descuentos_auditar();

ALTER TABLE public.categoria_cliente_descuentos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categoria_cliente_descuentos' AND policyname='cat_desc_select') THEN
    CREATE POLICY cat_desc_select ON public.categoria_cliente_descuentos FOR SELECT TO authenticated
      USING (tenant_id = get_user_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categoria_cliente_descuentos' AND policyname='cat_desc_insert') THEN
    CREATE POLICY cat_desc_insert ON public.categoria_cliente_descuentos FOR INSERT TO authenticated
      WITH CHECK (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categoria_cliente_descuentos' AND policyname='cat_desc_update') THEN
    CREATE POLICY cat_desc_update ON public.categoria_cliente_descuentos FOR UPDATE TO authenticated
      USING (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'))
      WITH CHECK (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categoria_cliente_descuentos' AND policyname='cat_desc_delete') THEN
    CREATE POLICY cat_desc_delete ON public.categoria_cliente_descuentos FOR DELETE TO authenticated
      USING (tenant_id = get_user_tenant_id() AND fn_usuario_en_roles_categoria('gestionar'));
  END IF;
END $$;

REVOKE ALL ON public.categoria_cliente_descuentos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categoria_cliente_descuentos TO authenticated;

-- Importación por Excel: TODO O NADA (D3-a). p_filas = [{ "fila": 12, "producto_id": "<uuid>", "descuento_pct": 15 }].
-- Escribe solo las filas que trae (upsert); no borra los productos que el archivo no menciona.
CREATE OR REPLACE FUNCTION public.fn_importar_descuentos_categoria(p_categoria_id uuid, p_filas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant  uuid := public.get_user_tenant_id();
  v_cat     text;
  v_malo    record;
  v_nuevos  int;
  v_total   int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuario sin negocio'; END IF;
  IF NOT fn_usuario_en_roles_categoria('gestionar') THEN
    RAISE EXCEPTION 'Tu rol no puede modificar las listas de descuento de las categorías';
  END IF;
  SELECT nombre INTO v_cat FROM categorias_cliente WHERE id = p_categoria_id AND tenant_id = v_tenant;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Categoría no encontrada'; END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN RAISE EXCEPTION 'No hay filas para cargar'; END IF;

  -- Validación de TODAS las filas antes de escribir (la pantalla ya validó; esto es la última línea de defensa).
  SELECT x.fila, x.producto_id, x.descuento_pct INTO v_malo
    FROM jsonb_to_recordset(p_filas) AS x(fila int, producto_id uuid, descuento_pct numeric)
   WHERE x.descuento_pct IS NULL OR x.descuento_pct < 0 OR x.descuento_pct > 100
      OR x.descuento_pct <> round(x.descuento_pct, 2)
      OR NOT EXISTS (SELECT 1 FROM productos p WHERE p.id = x.producto_id AND p.tenant_id = v_tenant)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Fila %: producto o descuento inválido (el descuento va de 0 a 100, con hasta 2 decimales)', v_malo.fila;
  END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(p_filas) AS x(producto_id uuid))
     <> (SELECT count(DISTINCT x.producto_id) FROM jsonb_to_recordset(p_filas) AS x(producto_id uuid)) THEN
    RAISE EXCEPTION 'El archivo trae el mismo producto más de una vez';
  END IF;

  SELECT count(*) INTO v_nuevos
    FROM jsonb_to_recordset(p_filas) AS x(producto_id uuid)
   WHERE NOT EXISTS (SELECT 1 FROM categoria_cliente_descuentos d WHERE d.categoria_id = p_categoria_id AND d.producto_id = x.producto_id);
  v_total := jsonb_array_length(p_filas);

  PERFORM set_config('g360.cat_desc_importando', '1', true);
  INSERT INTO categoria_cliente_descuentos (tenant_id, categoria_id, producto_id, descuento_pct)
  SELECT v_tenant, p_categoria_id, x.producto_id, x.descuento_pct
    FROM jsonb_to_recordset(p_filas) AS x(producto_id uuid, descuento_pct numeric)
  ON CONFLICT (categoria_id, producto_id) DO UPDATE SET descuento_pct = EXCLUDED.descuento_pct;
  PERFORM set_config('g360.cat_desc_importando', '', true);

  -- Una sola entrada en el historial de la categoría (fn_log_categoria no es ejecutable por authenticated; la policy de
  -- actividad_log deja insertar en el propio negocio).
  INSERT INTO actividad_log (tenant_id, usuario_id, usuario_nombre, entidad, entidad_id, entidad_nombre, accion, campo,
                             valor_anterior, valor_nuevo, pagina)
  VALUES (v_tenant, auth.uid(), COALESCE((SELECT nombre_display FROM users WHERE id = auth.uid()), 'Sistema'),
          'categoria_cliente', p_categoria_id::text, v_cat, 'importar', 'lista de descuentos', NULL,
          format('%s productos (%s nuevos, %s actualizados)', v_total, v_nuevos, v_total - v_nuevos), '/clientes');

  RETURN jsonb_build_object('creados', v_nuevos, 'actualizados', v_total - v_nuevos);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_importar_descuentos_categoria(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_importar_descuentos_categoria(uuid, jsonb) TO authenticated;
