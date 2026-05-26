-- Migration 140: Caja Fase 2.0 — Permisos y roles
-- v1.9.3 — relevamiento J/B5/B6/A2/C2/A4

-- ============================================================
-- 1) caja_sesiones.abierta_por — registra quién hizo la apertura
-- ============================================================
-- Para A2: DUEÑO/SUPERVISOR puede abrir caja a nombre de un cajero.
-- En ese caso, usuario_id = cajero (propietario), abierta_por = quien la abrió.
-- Para aperturas propias, usuario_id = abierta_por.
ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS abierta_por UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_caja_sesiones_abierta_por
  ON caja_sesiones(abierta_por) WHERE abierta_por IS NOT NULL;

-- Backfill: en sesiones existentes, abierta_por = usuario_id (eran auto-aperturas)
UPDATE caja_sesiones SET abierta_por = usuario_id WHERE abierta_por IS NULL;

COMMENT ON COLUMN caja_sesiones.abierta_por IS 'Usuario que ejecutó la acción de apertura (puede ser distinto de usuario_id si DUEÑO/SUPERVISOR abrió a nombre de un cajero). Para A2 del relevamiento Caja.';

-- ============================================================
-- 2) tenants.config_caja_jsonb — flags configurables para roles/permisos
-- ============================================================
-- Mejor que ir agregando columnas booleanas, uso un JSONB con defaults.
-- Estructura:
--   {
--     "supervisor_puede_editar_movimientos": false,
--     "supervisor_puede_ver_boveda": false,
--     "forzar_cierre_dia_anterior": true
--   }
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS config_caja JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.config_caja IS 'Configuración de permisos/comportamiento de Caja. Estructura {supervisor_puede_editar_movimientos, supervisor_puede_ver_boveda, forzar_cierre_dia_anterior, ...}';

-- ============================================================
-- 3) Helper SQL: requiere_clave_maestra
-- ============================================================
-- Centraliza la lógica de "qué acciones requieren clave maestra".
-- Acciones soportadas (texto libre, ampliable):
--   'cerrar_caja_ajena' · 'abrir_caja_diferencia' · 'anular_venta' · 'anular_movimiento'
CREATE OR REPLACE FUNCTION requiere_clave_maestra(p_tenant_id UUID, p_accion TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_clave TEXT;
BEGIN
  -- Si no hay clave maestra configurada en el tenant, ninguna acción la requiere
  SELECT clave_maestra INTO v_clave FROM tenants WHERE id = p_tenant_id;
  IF v_clave IS NULL OR LENGTH(TRIM(v_clave)) = 0 THEN
    RETURN FALSE;
  END IF;
  -- Lista de acciones que requieren clave maestra (B5 del relevamiento)
  RETURN p_accion IN ('cerrar_caja_ajena', 'abrir_caja_diferencia', 'anular_venta', 'anular_movimiento');
END $$;

COMMENT ON FUNCTION requiere_clave_maestra IS 'Devuelve TRUE si la acción dada requiere clave maestra para el tenant. Centraliza B5 del relevamiento Caja.';

-- ============================================================
-- 4) RPC verificar_clave_maestra(p_clave) — para validar desde frontend
-- ============================================================
CREATE OR REPLACE FUNCTION verificar_clave_maestra(p_tenant_id UUID, p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_clave_real TEXT;
BEGIN
  SELECT clave_maestra INTO v_clave_real FROM tenants WHERE id = p_tenant_id;
  IF v_clave_real IS NULL OR LENGTH(TRIM(v_clave_real)) = 0 THEN
    RETURN TRUE;  -- Sin clave configurada → no se requiere validar
  END IF;
  RETURN v_clave_real = p_clave;
END $$;

REVOKE ALL ON FUNCTION verificar_clave_maestra FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verificar_clave_maestra TO authenticated;

COMMENT ON FUNCTION verificar_clave_maestra IS 'Compara la clave maestra del tenant con la ingresada. SECURITY DEFINER para no exponer tenants.clave_maestra al frontend directamente.';
