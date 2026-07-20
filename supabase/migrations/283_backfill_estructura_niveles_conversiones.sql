-- 283: Corrige el backfill de la mig 282 — estructuras del importador CSV con
-- conversiones (unidades_por_caja / cajas_por_pallet) pero SIN dimensiones.
--
-- La 282 detectaba un nivel activo con el criterio del frontend viejo (peso+alto NOT
-- NULL), pero el importador de productos siempre permitió cargar solo la conversión
-- (sin peso ni medidas) — esas estructuras quedaron con el nivel base pelado y la
-- conversión (el dato operativo que importa para picking/putaway) se perdía del modelo
-- nuevo. Acá se reconstruyen los niveles de esas estructuras con el criterio ampliado:
-- nivel Caja si hay unidades_por_caja O dims; nivel Pallet si hay cajas_por_pallet O dims.
-- Dims ≤ 0 se normalizan a NULL (los CHECKs del modelo nuevo exigen > 0).
-- Idempotente: solo toca estructuras a las que les falta el nivel que sus columnas
-- viejas dicen que deberían tener. En PROD es no-op (0 estructuras a la fecha).

DO $$
DECLARE
  e RECORD;
  v_udm_unidad uuid;
  v_udm_caja   uuid;
  v_udm_pallet uuid;
  v_orden      integer;
  v_acum       bigint;
  v_factor     integer;
  v_tiene_caja   boolean;
  v_tiene_pallet boolean;
BEGIN
  FOR e IN
    SELECT pe.* FROM producto_estructuras pe
    WHERE
      (pe.unidades_por_caja IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM producto_estructura_niveles n
        JOIN unidades_medida um ON um.id = n.unidad_medida_id
        WHERE n.estructura_id = pe.id AND um.nombre = 'Caja'))
      OR
      (pe.cajas_por_pallet IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM producto_estructura_niveles n
        JOIN unidades_medida um ON um.id = n.unidad_medida_id
        WHERE n.estructura_id = pe.id AND um.nombre = 'Pallet'))
  LOOP
    SELECT id INTO v_udm_unidad FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Unidad';
    SELECT id INTO v_udm_caja   FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Caja';
    SELECT id INTO v_udm_pallet FROM unidades_medida WHERE tenant_id = e.tenant_id AND nombre = 'Pallet';
    IF v_udm_unidad IS NULL OR v_udm_caja IS NULL OR v_udm_pallet IS NULL THEN
      RAISE EXCEPTION 'Tenant % sin UdM predefinidas', e.tenant_id;
    END IF;

    DELETE FROM producto_estructura_niveles WHERE estructura_id = e.id;

    v_tiene_caja   := e.unidades_por_caja IS NOT NULL OR (e.peso_caja   IS NOT NULL AND e.alto_caja   IS NOT NULL);
    v_tiene_pallet := e.cajas_por_pallet  IS NOT NULL OR (e.peso_pallet IS NOT NULL AND e.alto_pallet IS NOT NULL);

    -- Nivel base Unidad: siempre (con dims si las hay)
    v_orden := 1; v_acum := 1;
    INSERT INTO producto_estructura_niveles
      (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
    VALUES (e.tenant_id, e.id, v_udm_unidad, 1, 1, 1,
      CASE WHEN e.peso_unidad  > 0 THEN e.peso_unidad  END,
      CASE WHEN e.alto_unidad  > 0 THEN e.alto_unidad  END,
      CASE WHEN e.ancho_unidad > 0 THEN e.ancho_unidad END,
      CASE WHEN e.largo_unidad > 0 THEN e.largo_unidad END);

    IF v_tiene_caja THEN
      v_orden := v_orden + 1;
      v_factor := GREATEST(COALESCE(e.unidades_por_caja, 1), 1);
      v_acum := v_acum * v_factor;
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
      VALUES (e.tenant_id, e.id, v_udm_caja, v_orden, v_factor, v_acum,
        CASE WHEN e.peso_caja  > 0 THEN e.peso_caja  END,
        CASE WHEN e.alto_caja  > 0 THEN e.alto_caja  END,
        CASE WHEN e.ancho_caja > 0 THEN e.ancho_caja END,
        CASE WHEN e.largo_caja > 0 THEN e.largo_caja END);
    END IF;

    IF v_tiene_pallet THEN
      v_orden := v_orden + 1;
      IF v_tiene_caja THEN
        v_factor := GREATEST(COALESCE(e.cajas_por_pallet, 1), 1);
      ELSE
        v_factor := GREATEST(COALESCE(e.cajas_por_pallet, 1) * COALESCE(e.unidades_por_caja, 1), 1);
      END IF;
      v_acum := v_acum * v_factor;
      INSERT INTO producto_estructura_niveles
        (tenant_id, estructura_id, unidad_medida_id, orden, factor, unidades_base, peso_kg, alto_cm, ancho_cm, largo_cm)
      VALUES (e.tenant_id, e.id, v_udm_pallet, v_orden, v_factor, v_acum,
        CASE WHEN e.peso_pallet  > 0 THEN e.peso_pallet  END,
        CASE WHEN e.alto_pallet  > 0 THEN e.alto_pallet  END,
        CASE WHEN e.ancho_pallet > 0 THEN e.ancho_pallet END,
        CASE WHEN e.largo_pallet > 0 THEN e.largo_pallet END);
    END IF;
  END LOOP;
END $$;
