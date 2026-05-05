-- migration 084: notificaciones + caja fuerte + mejoras apertura caja

-- Tabla notificaciones (backend real para la campana del header)
CREATE TABLE IF NOT EXISTS notificaciones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'info' CHECK (tipo IN ('info','warning','danger','success')),
  titulo      TEXT NOT NULL,
  mensaje     TEXT NOT NULL,
  leida       BOOLEAN NOT NULL DEFAULT FALSE,
  action_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_user_id  ON notificaciones(user_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_tenant_id ON notificaciones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida     ON notificaciones(user_id, leida) WHERE leida = FALSE;

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notificaciones' AND policyname = 'notif_user'
  ) THEN
    CREATE POLICY notif_user ON notificaciones
      FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- Columnas apertura caja
ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS monto_sugerido_apertura DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS diferencia_apertura     DECIMAL(12,2);

-- Caja fuerte roles configurable por tenant
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS caja_fuerte_roles TEXT[] DEFAULT ARRAY['OWNER','SUPERVISOR','ADMIN'];

-- Auto-crear caja fuerte al crear un tenant nuevo
CREATE OR REPLACE FUNCTION fn_crear_caja_fuerte()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte)
  VALUES (NEW.id, 'Caja Fuerte', TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crear_caja_fuerte ON tenants;
CREATE TRIGGER trg_crear_caja_fuerte
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_crear_caja_fuerte();

-- Backfill: crear caja fuerte para tenants existentes que no tienen
INSERT INTO cajas (tenant_id, nombre, es_caja_fuerte)
SELECT t.id, 'Caja Fuerte', TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cajas c WHERE c.tenant_id = t.id AND c.es_caja_fuerte = TRUE
);
