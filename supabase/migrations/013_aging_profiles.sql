-- ============================================================
-- 013_aging_profiles.sql
-- Perfiles de aging: cambio automático de estado según días hasta vencimiento
-- ============================================================

-- 1. Tabla de perfiles
CREATE TABLE IF NOT EXISTS aging_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aging_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aging_profiles_tenant" ON aging_profiles
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 2. Tabla de reglas por perfil
-- dias: umbral de días restantes hasta vencimiento
-- Lógica: se aplica la regla con el menor dias >= dias_restantes
CREATE TABLE IF NOT EXISTS aging_profile_reglas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES aging_profiles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estado_id   UUID NOT NULL REFERENCES estados_inventario(id) ON DELETE RESTRICT,
  dias        INT NOT NULL CHECK (dias >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aging_profile_reglas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aging_profile_reglas_tenant" ON aging_profile_reglas
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 3. FK en productos
ALTER TABLE productos ADD COLUMN IF NOT EXISTS aging_profile_id UUID REFERENCES aging_profiles(id) ON DELETE SET NULL;

-- 4. Función de procesamiento de aging
-- Cambia el estado de inventario_lineas según el perfil de aging del producto.
-- Inserta en actividad_log para auditoría.
-- Cuando se llama desde el frontend (sin argumento), procesa el tenant del usuario autenticado.
-- Cuando se llama con p_tenant_id explícito (desde Edge Function), procesa ese tenant.
CREATE OR REPLACE FUNCTION process_aging_profiles(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant UUID;
  v_linea         RECORD;
  v_estado_nuevo  UUID;
  v_estado_ant    TEXT;
  v_estado_nuevo_nombre TEXT;
  v_cambios       INT := 0;
  v_dias          INT;
BEGIN
  -- Resolver tenant: desde auth si no se pasa explícito
  IF p_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_target_tenant FROM users WHERE id = auth.uid();
  ELSE
    v_target_tenant := p_tenant_id;
  END IF;

  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'Tenant no encontrado', 'cambios', 0);
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
      AND p.aging_profile_id IS NOT NULL
      AND p.tiene_vencimiento = TRUE
      AND il.tenant_id = v_target_tenant
  LOOP
    -- Días restantes hasta vencimiento (negativo = ya venció)
    v_dias := (v_linea.fecha_vencimiento::DATE - CURRENT_DATE)::INT;

    -- Buscar la regla aplicable: menor umbral que cubra los días restantes
    SELECT apr.estado_id INTO v_estado_nuevo
    FROM aging_profile_reglas apr
    WHERE apr.profile_id = v_linea.aging_profile_id
      AND apr.dias >= v_dias
    ORDER BY apr.dias ASC
    LIMIT 1;

    -- Actualizar solo si hay regla y el estado cambió
    IF v_estado_nuevo IS NOT NULL AND v_estado_nuevo IS DISTINCT FROM v_linea.estado_id THEN
      SELECT nombre INTO v_estado_ant        FROM estados_inventario WHERE id = v_linea.estado_id;
      SELECT nombre INTO v_estado_nuevo_nombre FROM estados_inventario WHERE id = v_estado_nuevo;

      UPDATE inventario_lineas SET estado_id = v_estado_nuevo WHERE id = v_linea.id;

      INSERT INTO actividad_log (
        tenant_id, usuario_id, usuario_nombre,
        entidad, entidad_id, entidad_nombre,
        accion, campo, valor_anterior, valor_nuevo, pagina
      ) VALUES (
        v_linea.tenant_id,
        NULL, 'Sistema (Aging)',
        'inventario_linea', v_linea.id::TEXT, v_linea.prod_nombre,
        'cambio_estado_auto',
        'estado',
        COALESCE(v_estado_ant, 'Sin estado'),
        COALESCE(v_estado_nuevo_nombre, 'Sin estado'),
        '/aging-auto'
      );

      v_cambios := v_cambios + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'cambios', v_cambios,
    'tenant_id', v_target_tenant,
    'procesado_en', NOW()
  );
END;
$$;
