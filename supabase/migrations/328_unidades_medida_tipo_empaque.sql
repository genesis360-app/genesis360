-- Fede 25/7, punto 6: categoría informativa de empaque (Unidad/Caja/Pallet/Bolsa/Bulto),
-- separada del nombre libre por SKU (ese no cambia). Puramente para reportes/categorización —
-- NO tiene función técnica: el enlace tier↔empaque del punto 1 usa producto_presentaciones.id
-- (identidad de línea), no esta columna.
--
-- Sin CHECK constraint a propósito (mismo criterio que combos.descuento_tipo): es una lista
-- abierta que puede crecer sin necesitar una migración cada vez; la UI valida contra una
-- constante fija en el frontend.

ALTER TABLE public.unidades_medida ADD COLUMN IF NOT EXISTS tipo_empaque text;

COMMENT ON COLUMN public.unidades_medida.tipo_empaque IS
  'Categoría informativa (Unidad/Caja/Pallet/Bolsa/Bulto/...) para reportes. Sin función técnica.';

-- Backfill de las predefinidas que sobrevivieron a la limpieza de la mig 327.
UPDATE public.unidades_medida SET tipo_empaque = 'Caja' WHERE predefinida = true AND nombre = 'Caja' AND tipo_empaque IS NULL;
UPDATE public.unidades_medida SET tipo_empaque = 'Pallet' WHERE predefinida = true AND nombre = 'Pallet' AND tipo_empaque IS NULL;
UPDATE public.unidades_medida SET tipo_empaque = 'Unidad' WHERE predefinida = true AND nombre = 'Unidad' AND tipo_empaque IS NULL;
