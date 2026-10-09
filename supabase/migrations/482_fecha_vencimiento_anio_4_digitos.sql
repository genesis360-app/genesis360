-- 482 — Fecha de vencimiento con año de 4 dígitos como máximo (REGLA #0, inventario). Caso de GO 2026-10-08 (DEV, Almacén de
-- la Suerte): un LPN de 600 u. quedó con vencimiento "20207-04-04" (un dígito de más en el año: el input de fecha del
-- navegador acepta hasta 6). Todo el código compara vencimientos como texto ISO (`fecha_vencimiento >= hoy`), que solo vale
-- con años de 4 dígitos: "20207-…" < "2026-…" → el lote se trataba como VENCIDO y el POS no lo ofrecía.
--
-- NOT VALID: frena lo que se cargue de acá en adelante sin romper filas viejas (en DEV hay 2 en Almacén de la Suerte; en PROD
-- 0, verificado). Una fila vieja fuera de rango no se puede actualizar hasta que se corrija la fecha.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_lineas_fecha_vencimiento_anio_check') THEN
    ALTER TABLE public.inventario_lineas ADD CONSTRAINT inventario_lineas_fecha_vencimiento_anio_check
      CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento <= DATE '9999-12-31') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recepcion_items_fecha_vencimiento_anio_check') THEN
    ALTER TABLE public.recepcion_items ADD CONSTRAINT recepcion_items_fecha_vencimiento_anio_check
      CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento <= DATE '9999-12-31') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traslado_items_fecha_vencimiento_anio_check') THEN
    ALTER TABLE public.traslado_items ADD CONSTRAINT traslado_items_fecha_vencimiento_anio_check
      CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento <= DATE '9999-12-31') NOT VALID;
  END IF;
END $$;
