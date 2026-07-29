-- ============================================================
-- 322_cubicaje_opt_in.sql
-- 📦 CUBICAJE VOLUMÉTRICO opt-in — FASE A (datos). Pedido de GO (2026-07-29).
--
-- El reparo de siempre contra el cubicaje es que "con medidas a medias el número miente, y un
-- número que miente es peor que no tener ninguno". La idea de GO lo resuelve de raíz: se **activa
-- por tenant**, y al activarlo las medidas pasan a ser **obligatorias** al editar una estructura →
-- la cobertura es 100% por construcción para todo lo que se cargue de ahí en adelante. El que no lo
-- necesita no paga el costo de cargar esos datos.
--
-- ⚠ Prender el toggle NO completa los SKU que ya existen. Por eso está `fn_cubicaje_cobertura`: la
-- app tiene que mostrar "12 de 200 SKU medidos" y decir sobre qué porcentaje se calculó el volumen,
-- en vez de dar un número que parece completo y no lo está.
--
-- `cubicaje_factor_aprovechamiento`: ninguna ubicación real se llena al 100% geométrico (pasillos,
-- forma irregular, mercadería que no apila). Sin este factor el sistema diría "entra" cuando no
-- entra. 0.70 es el default típico de la industria (60-75%).
--
-- Decisión de GO: el **peso también es obligatorio por nivel** (no derivado del factor), porque el
-- peso real de un bulto incluye su embalaje — una caja de 12 pesa más que 12 unidades sueltas.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cubicaje_habilitado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cubicaje_factor_aprovechamiento numeric NOT NULL DEFAULT 0.70;

COMMENT ON COLUMN tenants.cubicaje_habilitado IS
  'Cubicaje volumétrico (mig 322). Si es true, el editor de estructura EXIGE peso y medidas en cada nivel y se calcula el volumen ocupado de cada ubicación. Default false: el que no lo necesita no carga esos datos.';
COMMENT ON COLUMN tenants.cubicaje_factor_aprovechamiento IS
  'Fracción del volumen geométrico de una ubicación que se considera usable (default 0.70). Ninguna posición real se llena al 100%: pasillos, forma irregular, mercadería que no apila. Sin esto el sistema diría "entra" cuando no entra.';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_cubicaje_factor;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_cubicaje_factor
  CHECK (cubicaje_factor_aprovechamiento > 0 AND cubicaje_factor_aprovechamiento <= 1);

-- ── Guard server-side: con cubicaje activo, ningún nivel puede quedar sin medir ──────────
-- La UI lo exige, pero se cachea y el importador/EFs escriben con service_role sin pasar por ella.
-- Si el dato entra incompleto por otro camino, el volumen calculado queda corto y vuelve a mentir.
CREATE OR REPLACE FUNCTION public.trg_presentacion_exige_medidas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_on boolean;
BEGIN
  SELECT COALESCE(cubicaje_habilitado, false) INTO v_on FROM tenants WHERE id = NEW.tenant_id;
  IF NOT v_on THEN RETURN NEW; END IF;

  IF COALESCE(NEW.peso_kg, 0) <= 0
     OR COALESCE(NEW.alto_cm, 0) <= 0
     OR COALESCE(NEW.ancho_cm, 0) <= 0
     OR COALESCE(NEW.largo_cm, 0) <= 0 THEN
    RAISE EXCEPTION 'El cubicaje está activado: "%" necesita peso y las tres medidas (alto, ancho, largo) mayores a 0. Cargalas en la estructura del producto o desactivá el cubicaje en Configuración → Inventario.',
      COALESCE(NEW.etiqueta, 'la presentación');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_presentacion_exige_medidas() IS
  'Con `tenants.cubicaje_habilitado` en true, ninguna presentación puede guardarse sin peso ni medidas (mig 322). La UI ya lo exige; esto cubre el importador y las EF, que escriben con service_role.';

DROP TRIGGER IF EXISTS trg_presentaciones_exige_medidas ON producto_presentaciones;
CREATE TRIGGER trg_presentaciones_exige_medidas
  BEFORE INSERT OR UPDATE OF peso_kg, alto_cm, ancho_cm, largo_cm, etiqueta
  ON producto_presentaciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_presentacion_exige_medidas();

-- ── FASE B (parcial): la vista de ocupación suma el VOLUMEN real de lo guardado ─────────
-- El volumen de una línea sale de la presentación en la que ENTRÓ (`inventario_lineas.
-- unidad_medida_id` / `cantidad_uom`, mig 293): "3 cajas" ocupa 3 × el volumen de la caja, no
-- 36 × el volumen de la unidad suelta. Si la línea no dice presentación, se cae a la base.
DROP VIEW IF EXISTS vw_ubicacion_ocupacion;
CREATE VIEW vw_ubicacion_ocupacion
WITH (security_invoker = true)
AS
SELECT
  il.tenant_id,
  il.ubicacion_id,
  count(*)::integer                                               AS lpn_activos,
  COALESCE(SUM(il.cantidad * COALESCE(p.peso_kg, 0)), 0)::numeric AS peso_kg,
  count(*) FILTER (WHERE COALESCE(p.peso_kg, 0) > 0)::integer     AS lineas_con_peso,
  count(*)::integer                                               AS lineas_total,
  COALESCE(SUM(
    CASE WHEN COALESCE(pp.alto_cm,0) > 0 AND COALESCE(pp.ancho_cm,0) > 0 AND COALESCE(pp.largo_cm,0) > 0
      THEN (pp.alto_cm * pp.ancho_cm * pp.largo_cm / 1000000.0)
           * COALESCE(NULLIF(il.cantidad_uom, 0), il.cantidad / NULLIF(pp.factor_base, 0), il.cantidad)
      ELSE 0 END
  ), 0)::numeric                                                  AS volumen_m3,
  count(*) FILTER (WHERE COALESCE(pp.alto_cm,0) > 0 AND COALESCE(pp.ancho_cm,0) > 0
                     AND COALESCE(pp.largo_cm,0) > 0)::integer    AS lineas_con_volumen
FROM inventario_lineas il
JOIN productos p ON p.id = il.producto_id
LEFT JOIN producto_presentaciones pp
  ON pp.producto_id = il.producto_id
 AND pp.activo = true
 AND (pp.id = il.unidad_medida_id OR (il.unidad_medida_id IS NULL AND pp.es_base))
WHERE il.activo = true AND il.ubicacion_id IS NOT NULL
GROUP BY il.tenant_id, il.ubicacion_id;

COMMENT ON VIEW vw_ubicacion_ocupacion IS
  'Ocupación real de cada ubicación (migs 321/322): LPN activos, peso total y VOLUMEN en m³ de lo guardado, calculado sobre la presentación en la que entró cada línea. lineas_con_peso/lineas_con_volumen/lineas_total dan la COBERTURA: si faltan datos el total queda corto y hay que decirlo.';

REVOKE ALL ON vw_ubicacion_ocupacion FROM PUBLIC, anon;
GRANT SELECT ON vw_ubicacion_ocupacion TO authenticated, service_role;

-- ── Cobertura de medición del catálogo (para el panel de Config) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cubicaje_cobertura(p_tenant_id uuid)
RETURNS TABLE (productos_total integer, productos_medidos integer, presentaciones_sin_medir integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH act AS (
    SELECT pr.id
    FROM productos pr
    WHERE pr.tenant_id = p_tenant_id AND pr.activo = true
      AND NOT EXISTS (SELECT 1 FROM productos h WHERE h.producto_padre_id = pr.id)  -- las madres no se guardan
  )
  SELECT
    (SELECT count(*)::integer FROM act),
    (SELECT count(*)::integer FROM act a
      WHERE EXISTS (SELECT 1 FROM producto_presentaciones pp WHERE pp.producto_id = a.id AND pp.activo)
        AND NOT EXISTS (
          SELECT 1 FROM producto_presentaciones pp
          WHERE pp.producto_id = a.id AND pp.activo
            AND (COALESCE(pp.peso_kg,0) <= 0 OR COALESCE(pp.alto_cm,0) <= 0
                 OR COALESCE(pp.ancho_cm,0) <= 0 OR COALESCE(pp.largo_cm,0) <= 0))),
    (SELECT count(*)::integer FROM producto_presentaciones pp
      JOIN act a ON a.id = pp.producto_id
     WHERE pp.activo
       AND (COALESCE(pp.peso_kg,0) <= 0 OR COALESCE(pp.alto_cm,0) <= 0
            OR COALESCE(pp.ancho_cm,0) <= 0 OR COALESCE(pp.largo_cm,0) <= 0));
$$;

COMMENT ON FUNCTION public.fn_cubicaje_cobertura(uuid) IS
  'Cuántos productos tienen TODAS sus presentaciones medidas (mig 322). Activar el cubicaje no completa el catálogo existente: sin este número el volumen ocupado parecería completo cuando no lo está.';

REVOKE ALL ON FUNCTION fn_cubicaje_cobertura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_cubicaje_cobertura(uuid) TO authenticated, service_role;
