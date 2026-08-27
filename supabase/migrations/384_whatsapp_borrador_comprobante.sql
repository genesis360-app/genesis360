-- Migration 384: Fase 3 del "Asistente de WhatsApp con IA" — soporte de fotos/audio.
-- Cuando el bot arma un borrador de gasto (proponer_gasto) a partir de una FOTO de un comprobante,
-- esa misma foto se sube a `comprobantes-gastos` y se linkea acá — así, cuando un humano aprueba
-- el borrador desde el modal "Nuevo Gasto" (GastosPage.tsx → abrirDesdeBorrador), el comprobante ya
-- viene precargado, sin pedirle la foto de nuevo a nadie. Nunca bloquea el borrador si la subida
-- del archivo falla (queda NULL, se puede subir a mano después, como siempre).
ALTER TABLE whatsapp_gastos_borrador ADD COLUMN IF NOT EXISTS comprobante_url TEXT;
