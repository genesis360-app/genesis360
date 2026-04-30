-- Migration 078: plantilla de WhatsApp por tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_plantilla TEXT;
