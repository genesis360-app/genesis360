-- Migration 123: Config Fases 2/3/4 — nuevas columnas en tenants
-- Fase 2: identidad y operativa
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS email_legal            TEXT,
  ADD COLUMN IF NOT EXISTS precio_redondeo        TEXT    NOT NULL DEFAULT 'none'
    CHECK (precio_redondeo IN ('none','10','50','100','500','1000')),

-- Fase 3: cliente en POS
  ADD COLUMN IF NOT EXISTS cliente_obligatorio    TEXT    NOT NULL DEFAULT 'nunca'
    CHECK (cliente_obligatorio IN ('siempre','reservas','nunca')),
  ADD COLUMN IF NOT EXISTS cliente_datos_minimos  TEXT    NOT NULL DEFAULT 'nombre'
    CHECK (cliente_datos_minimos IN ('nombre','nombre_dni','nombre_dni_email','todos')),
  ADD COLUMN IF NOT EXISTS cliente_consumidor_final BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cliente_creacion_inline  BOOLEAN NOT NULL DEFAULT true,

-- Fase 4: descuentos y caja
  ADD COLUMN IF NOT EXISTS descuento_max_cajero_pct      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS descuento_max_supervisor_pct  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS clave_maestra         TEXT,
  ADD COLUMN IF NOT EXISTS boveda_umbral_caja    NUMERIC(12,2);

COMMENT ON COLUMN tenants.email_legal            IS 'Email para notificaciones fiscales y facturación';
COMMENT ON COLUMN tenants.precio_redondeo        IS 'Redondeo automático del precio de venta (none/10/50/100/500/1000)';
COMMENT ON COLUMN tenants.cliente_obligatorio    IS 'Cuándo se requiere cliente en la venta POS';
COMMENT ON COLUMN tenants.descuento_max_cajero_pct     IS '% máximo de descuento que puede aplicar un CAJERO sin autorización';
COMMENT ON COLUMN tenants.descuento_max_supervisor_pct IS '% máximo de descuento para SUPERVISOR sin autorización superior';
COMMENT ON COLUMN tenants.clave_maestra          IS 'Contraseña para cierre de caja ajena (hash bcrypt o plain por ahora)';
COMMENT ON COLUMN tenants.boveda_umbral_caja     IS 'Monto máximo que puede haber en caja antes de transferir a bóveda';
