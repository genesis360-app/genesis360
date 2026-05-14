-- Migration 106: función para procesar un único aging profile
-- Misma lógica que process_aging_profiles pero filtrada a un perfil específico

CREATE OR REPLACE FUNCTION process_aging_profile_single(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant    UUID;
  v_linea            RECORD;
  v_estado_nuevo     UUID;
  v_estado_ant       TEXT;
  v_estado_nuevo_nom TEXT;
  v_cambios          INT := 0;
  v_dias             INT;
BEGIN
  -- Resolver tenant desde la sesión activa
  SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
  END IF;

  -- Verificar que el perfil pertenece al tenant
  IF NOT EXISTS (SELECT 1 FROM aging_profiles WHERE id = p_profile_id AND tenant_id = v_target_tenant) THEN
    RETURN jsonb_build_object('error', 'Perfil no encontrado', 'cambios', 0);
  END IF;

  FOR v_linea IN
    SELECT
      il.id,
      il.estado_id,
      il.fecha_vencimiento,
      il.tenant_id,
      il.producto_id,
      p.aging_profile_id,
      p.nombre AS prod_nombre
    FROM inventario_lineas il
    JOIN productos p ON p.id = il.producto_id
    WHERE il.activo = TRUE
      AND il.fecha_vencimiento IS NOT NULL
      AND p.aging_profile_id = p_profile_id
      AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;

    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = p_profile_id
      AND apr.dias >= v_dias
    ORDER BY apr.dias ASC
    LIMIT 1;

    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant
      FROM estados_inventario WHERE id = v_linea.estado_id;

      SELECT nombre INTO v_estado_nuevo_nom
      FROM estados_inventario WHERE id = v_estado_nuevo;

      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;

      INSERT INTO actividad_log (
        tenant_id, entidad, entidad_id, entidad_nombre,
        accion, campo, valor_anterior, valor_nuevo, pagina
      ) VALUES (
        v_linea.tenant_id, 'inventario_linea', v_linea.id, v_linea.prod_nombre,
        'cambio_estado', 'estado',
        COALESCE(v_estado_ant, 'sin estado'), v_estado_nuevo_nom,
        'aging_profile_single'
      );

      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cambios', v_cambios, 'profile_id', p_profile_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_aging_profile_single(UUID) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_aging_profile_single(UUID) TO authenticated;
