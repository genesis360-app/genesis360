-- ============================================================
-- 287_fn_estructura_niveles_precio.sql
-- Extiende fn_estructura_guardar_niveles (mig 282) para aceptar precio_venta/precio_costo
-- opcionales por nivel (backlog Fede, puntos 4/6/7). Misma función, mismo contrato de
-- entrada (jsonb con un objeto por nivel) — solo suma dos claves opcionales:
--   { unidad_medida_id, factor, peso_kg?, alto_cm?, ancho_cm?, largo_cm?, precio_venta?, precio_costo? }
-- Sin validación cruzada entre niveles (un nivel superior puede tener precio_venta MENOR al
-- de un nivel inferior — no hay evidencia de que haga falta bloquear eso, mismo criterio que
-- la decisión ya tomada para las CANTIDADES de los niveles).
-- ============================================================

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
  -- RLS aplica (SECURITY INVOKER): si la estructura no es del tenant del caller, no se ve.
  SELECT tenant_id INTO v_tenant_id FROM producto_estructuras WHERE id = p_estructura_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Estructura inexistente o sin permisos';
  END IF;

  IF p_niveles IS NULL OR jsonb_typeof(p_niveles) <> 'array' OR jsonb_array_length(p_niveles) < 1 THEN
    RAISE EXCEPTION 'La estructura necesita al menos un nivel';
  END IF;

  -- UdM repetidas dentro del array
  SELECT count(DISTINCT n->>'unidad_medida_id') INTO v_udm_count
  FROM jsonb_array_elements(p_niveles) n;
  IF v_udm_count <> jsonb_array_length(p_niveles) THEN
    RAISE EXCEPTION 'No se puede repetir la misma unidad de medida en dos niveles';
  END IF;

  DELETE FROM producto_estructura_niveles WHERE estructura_id = p_estructura_id;

  FOR v_nivel IN SELECT * FROM jsonb_array_elements(p_niveles) LOOP
    v_orden := v_orden + 1;
    v_udm_id := (v_nivel->>'unidad_medida_id')::uuid;

    -- La UdM debe ser visible por el caller (RLS) y del mismo tenant que la estructura.
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

  -- Si el nivel anclado (productos.nivel_precio_orden) ya no existe en la estructura DEFAULT
  -- tras este guardado (se achicó por debajo de esa posición), se invalida solo — vuelve al
  -- nivel base. La app debe avisar ANTES de confirmar un guardado que rompería el ancla; esto
  -- es la red de seguridad server-side (REGLA #0: nunca dejar un ancla apuntando a la nada).
  UPDATE productos p
  SET nivel_precio_orden = NULL
  WHERE p.nivel_precio_orden IS NOT NULL
    AND p.nivel_precio_orden > v_orden
    AND EXISTS (
      SELECT 1 FROM producto_estructuras pe
      WHERE pe.id = p_estructura_id AND pe.producto_id = p.id AND pe.is_default = true
    );
END;
$$;
