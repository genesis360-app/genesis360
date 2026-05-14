-- Migration 108: número de ticket por sucursal (ISS-085) + config cuotas bancos (ISS-086)
--               + archivos comprobante en OC (ISS-096)

-- ─── ISS-085: número de ticket por sucursal ──────────────────────────────────

-- Código corto configurable por sucursal (usado como prefijo del ticket)
ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Número secuencial local por sucursal (se resetea por sucursal)
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS numero_sucursal INTEGER;

-- Trigger actualizado: asigna numero global + numero_sucursal si hay sucursal
CREATE OR REPLACE FUNCTION gen_venta_numero()
RETURNS TRIGGER AS $$
BEGIN
  -- número global por tenant (backward-compat)
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id;
  END IF;
  -- número local por sucursal
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── ISS-086: config de cuotas por banco en el tenant ───────────────────────

-- JSONB con estructura: [{ "nombre": "Banco Galicia", "cuotas": [{ "cant": 3, "sin_interes": true, "interes": 0 }] }]
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cuotas_bancos JSONB;

-- Almacena info de cuotas en la venta: { banco, cuotas, interes, monto_cuota, sin_interes }
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS cuotas_info JSONB;

-- ─── ISS-096: comprobante de pago en OC ─────────────────────────────────────

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS comprobante_url   TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_titulo TEXT;
