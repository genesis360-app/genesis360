-- 268: Multi-CUIT (F5) — Fases 2/3: certificados y puntos de venta POR EMISOR.
--
-- Hasta acá el modelo asumía 1 CUIT por tenant:
--   · tenant_certificates tenía UNIQUE (tenant_id) → un solo certificado por tenant.
--   · puntos_venta_afip tenía UNIQUE (tenant_id, numero) → el PV 1 no podía repetirse,
--     pero en AFIP la numeración de PV es POR CUIT (el PV 1 del CUIT A ≠ PV 1 del CUIT B).
-- Con multi-emisor ambas unicidades pasan a girar alrededor de emisor_id (mig 267).
--
-- ⚠ El upsert de src/lib/afip.ts usaba onConflict:'tenant_id' — se actualiza en el mismo
-- release a onConflict:'emisor_id' (por eso el índice de emisor NO es parcial: supabase-js
-- no soporta predicados en ON CONFLICT; un UNIQUE total sobre columna nullable permite
-- múltiples NULL, que es lo que queremos para las filas legacy).

-- Certificados: uno por EMISOR
ALTER TABLE tenant_certificates DROP CONSTRAINT IF EXISTS tenant_certificates_tenant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_certificates_emisor
  ON tenant_certificates (emisor_id);
-- Compat legacy: como máximo UNA fila sin emisor por tenant (filas previas a mig 267 no
-- backfilleadas — en DEV/PROD el backfill las cubrió, esto es un cinturón de seguridad).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_certificates_tenant_legacy
  ON tenant_certificates (tenant_id) WHERE emisor_id IS NULL;

-- Puntos de venta: numeración por EMISOR
ALTER TABLE puntos_venta_afip DROP CONSTRAINT IF EXISTS puntos_venta_afip_tenant_id_numero_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_puntos_venta_afip_emisor_numero
  ON puntos_venta_afip (tenant_id, COALESCE(emisor_id, '00000000-0000-0000-0000-000000000000'::uuid), numero);
