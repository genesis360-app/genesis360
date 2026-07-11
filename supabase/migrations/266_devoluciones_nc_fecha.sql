-- 266: fecha de EMISIÓN de la NC electrónica (REGLA #0 fiscal — Libro IVA).
--
-- `devoluciones.created_at` es la fecha de la DEVOLUCIÓN; la NC puede emitirse días después.
-- El Libro IVA Ventas imputa la NC al período fiscal de su emisión (CbteFch del comprobante),
-- así que necesita una fecha propia. La setea la EF `emitir-factura` al persistir el CAE de
-- la NC (junto con nc_cae/nc_tipo/nc_numero_comprobante).
--
-- Backfill: las NC ya emitidas (solo comprobantes de homologación a la fecha) toman
-- created_at como mejor aproximación disponible.

ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS nc_fecha timestamptz;

COMMENT ON COLUMN devoluciones.nc_fecha IS
  'Fecha de emisión de la NC electrónica (CbteFch). La setea la EF emitir-factura al persistir el CAE. Distinta de created_at (fecha de la devolución). El Libro IVA imputa la NC a este período.';

UPDATE devoluciones SET nc_fecha = created_at WHERE nc_cae IS NOT NULL AND nc_fecha IS NULL;
