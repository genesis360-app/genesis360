-- 341 — Motor de Rotación de productos con descuento: SOLO esquema de configuración.
-- Relevamiento `relevamiento_rotacion_descuento_respuestas.md` (Fede, 2026-08-03 + GO 2026-08-07).
-- A propósito NO incluye ninguna lógica de EJECUCIÓN (bloqueo real de reposición, prioridad real de
-- envíos, disparo automático de armado de kits) — 3 preguntas del relevamiento (B4, C2, E5) siguen
-- sin cerrar y esa lógica depende de ellas. Esto es aditivo, sin comportamiento nuevo hasta que se
-- construya la UI y la ejecución.
--
-- Jerarquía de 3 niveles (A3, mismo patrón que `regla_inventario`): producto > categoría > tenant.
-- Mismas 3 reglas (A1) + ubicación de excepción (F1) en los 3 niveles; NULL = no hay override en ese
-- nivel, se cae al siguiente. En `tenants` son NOT NULL (default raíz, siempre resuelve).
--
-- Matriz de compatibilidad (A1-c): 1+2 permitido, 2+3 permitido, 1+3 BLOQUEADO. El CHECK por fila
-- SOLO cubre el conflicto DENTRO del mismo nivel — NO impide que la resolución cruzando niveles
-- (producto NULL → cae a categoría; categoría NULL → cae a tenant) termine devolviendo 1+3 activo
-- si cada nivel individualmente cumple su propio CHECK (ej. tenant con regla 1, categoría con regla
-- 3, ninguno viola su CHECK propio pero el resultado EFECTIVO sí). Migration-reviewer lo detectó:
-- validar esto en escritura exigiría revalidar todos los productos/categorías descendientes cada vez
-- que cambia un nivel superior (caro/complejo) — se difiere a cuando se construya la UI de edición.
-- Mientras tanto, `fn_rotacion_reglas_efectivas` aplica un desempate explícito de solo LECTURA
-- (agotar_antes_reponer gana) para que nunca devuelva la combinación prohibida.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS rotacion_agotar_antes_reponer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotacion_prioridad_envios     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotacion_armar_kits            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotacion_ubicacion_excepcion_id uuid REFERENCES public.ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS rotacion_agotar_antes_reponer boolean,
  ADD COLUMN IF NOT EXISTS rotacion_prioridad_envios     boolean,
  ADD COLUMN IF NOT EXISTS rotacion_armar_kits            boolean,
  ADD COLUMN IF NOT EXISTS rotacion_ubicacion_excepcion_id uuid REFERENCES public.ubicaciones(id) ON DELETE SET NULL;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS rotacion_agotar_antes_reponer boolean,
  ADD COLUMN IF NOT EXISTS rotacion_prioridad_envios     boolean,
  ADD COLUMN IF NOT EXISTS rotacion_armar_kits            boolean,
  ADD COLUMN IF NOT EXISTS rotacion_ubicacion_excepcion_id uuid REFERENCES public.ubicaciones(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenants_rotacion_matriz') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT chk_tenants_rotacion_matriz
      CHECK (NOT (rotacion_agotar_antes_reponer AND rotacion_armar_kits));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_categorias_rotacion_matriz') THEN
    ALTER TABLE public.categorias ADD CONSTRAINT chk_categorias_rotacion_matriz
      CHECK (NOT (COALESCE(rotacion_agotar_antes_reponer, false) AND COALESCE(rotacion_armar_kits, false)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_productos_rotacion_matriz') THEN
    ALTER TABLE public.productos ADD CONSTRAINT chk_productos_rotacion_matriz
      CHECK (NOT (COALESCE(rotacion_agotar_antes_reponer, false) AND COALESCE(rotacion_armar_kits, false)));
  END IF;
END $$;

-- Guard de mismo-tenant para `rotacion_ubicacion_excepcion_id` — mismo patrón que
-- `trg_ubicaciones_valida_padre` (mig 334) para `padre_ubicacion_id`. Sin esto, nada impide guardar
-- una ubicación de OTRO tenant (bug latente de inventario, REGLA #0) apenas exista un write-path.
CREATE OR REPLACE FUNCTION public.fn_valida_rotacion_ubicacion_mismo_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ubic_tenant uuid;
  v_tenant_esperado uuid;
BEGIN
  IF NEW.rotacion_ubicacion_excepcion_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_ubic_tenant FROM ubicaciones WHERE id = NEW.rotacion_ubicacion_excepcion_id;
  v_tenant_esperado := CASE WHEN TG_TABLE_NAME = 'tenants' THEN NEW.id ELSE NEW.tenant_id END;
  IF v_ubic_tenant IS NULL OR v_ubic_tenant <> v_tenant_esperado THEN
    RAISE EXCEPTION 'La ubicación de excepción de Rotación debe pertenecer al mismo tenant';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_rotacion_ubicacion ON public.tenants;
CREATE TRIGGER trg_tenants_rotacion_ubicacion
  BEFORE INSERT OR UPDATE OF rotacion_ubicacion_excepcion_id ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_rotacion_ubicacion_mismo_tenant();

DROP TRIGGER IF EXISTS trg_categorias_rotacion_ubicacion ON public.categorias;
CREATE TRIGGER trg_categorias_rotacion_ubicacion
  BEFORE INSERT OR UPDATE OF rotacion_ubicacion_excepcion_id ON public.categorias
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_rotacion_ubicacion_mismo_tenant();

DROP TRIGGER IF EXISTS trg_productos_rotacion_ubicacion ON public.productos;
CREATE TRIGGER trg_productos_rotacion_ubicacion
  BEFORE INSERT OR UPDATE OF rotacion_ubicacion_excepcion_id ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_rotacion_ubicacion_mismo_tenant();

-- B2 — switch aparte de `descuento_pct`: un estado puede tener descuento sin disparar Rotación.
ALTER TABLE public.estados_inventario
  ADD COLUMN IF NOT EXISTS dispara_rotacion boolean NOT NULL DEFAULT false;

-- Resuelve las reglas efectivas de un producto siguiendo la jerarquía SKU > categoría > tenant
-- (A3). Función de solo LECTURA — no ejecuta ninguna de las 3 reglas, solo dice cuáles están
-- activas. Desempate explícito si la resolución cruzando niveles diera 1+3 a la vez (ver nota de
-- cabecera): `agotar_antes_reponer` gana, `armar_kits` se fuerza a `false`.
CREATE OR REPLACE FUNCTION public.fn_rotacion_reglas_efectivas(p_producto_id uuid)
RETURNS TABLE (
  agotar_antes_reponer boolean,
  prioridad_envios     boolean,
  armar_kits           boolean,
  ubicacion_excepcion_id uuid
)
LANGUAGE sql STABLE
SET search_path = 'public'
AS $$
  SELECT
    r.agotar_antes_reponer,
    r.prioridad_envios,
    (r.armar_kits AND NOT r.agotar_antes_reponer) AS armar_kits,
    r.ubicacion_excepcion_id
  FROM (
    SELECT
      COALESCE(p.rotacion_agotar_antes_reponer, c.rotacion_agotar_antes_reponer, t.rotacion_agotar_antes_reponer) AS agotar_antes_reponer,
      COALESCE(p.rotacion_prioridad_envios,     c.rotacion_prioridad_envios,     t.rotacion_prioridad_envios)     AS prioridad_envios,
      COALESCE(p.rotacion_armar_kits,            c.rotacion_armar_kits,            t.rotacion_armar_kits)          AS armar_kits,
      COALESCE(p.rotacion_ubicacion_excepcion_id, c.rotacion_ubicacion_excepcion_id, t.rotacion_ubicacion_excepcion_id) AS ubicacion_excepcion_id
    FROM public.productos p
    JOIN public.tenants t ON t.id = p.tenant_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    WHERE p.id = p_producto_id
  ) r;
$$;

REVOKE ALL ON FUNCTION public.fn_rotacion_reglas_efectivas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_rotacion_reglas_efectivas(uuid) TO authenticated, service_role;
