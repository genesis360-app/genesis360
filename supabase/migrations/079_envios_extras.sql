-- Migration 079: costo de envío por km + plantilla WhatsApp
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS costo_envio_por_km DECIMAL(10,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_plantilla TEXT;
