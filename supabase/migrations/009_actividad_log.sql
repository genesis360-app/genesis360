-- ============================================================
-- 009_actividad_log.sql
-- Registro de actividad / audit log por tenant
-- ============================================================

CREATE TABLE IF NOT EXISTS actividad_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES users(id),
  usuario_nombre  TEXT,                        -- snapshot del nombre al momento del log
  entidad         TEXT NOT NULL,               -- 'producto', 'inventario_linea', 'venta', 'categoria', 'proveedor', 'ubicacion', 'estado', 'motivo', 'usuario', 'gasto'
  entidad_id      TEXT,                        -- UUID o ID de la entidad afectada
  entidad_nombre  TEXT,                        -- nombre legible (ej: nombre del producto)
  accion          TEXT NOT NULL,               -- 'crear', 'editar', 'eliminar', 'cambio_estado'
  campo           TEXT,                        -- campo modificado (solo para accion='editar')
  valor_anterior  TEXT,
  valor_nuevo     TEXT,
  pagina          TEXT,                        -- ruta donde ocurrió ('/inventario', '/ventas', etc.)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS actividad_log_tenant_idx    ON actividad_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS actividad_log_entidad_idx   ON actividad_log (tenant_id, entidad);
CREATE INDEX IF NOT EXISTS actividad_log_usuario_idx   ON actividad_log (tenant_id, usuario_id);

ALTER TABLE actividad_log ENABLE ROW LEVEL SECURITY;

-- INSERT: cualquier usuario autenticado del tenant puede insertar
CREATE POLICY "actividad_log_insert" ON actividad_log
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- SELECT: solo OWNER, SUPERVISOR y ADMIN (no CAJERO)
CREATE POLICY "actividad_log_select" ON actividad_log
  FOR SELECT USING (
    is_admin()
    OR tenant_id IN (
      SELECT tenant_id FROM users
      WHERE id = auth.uid()
      AND rol IN ('OWNER', 'SUPERVISOR')
    )
  );
