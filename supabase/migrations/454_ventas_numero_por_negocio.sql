-- 454 — El número de venta vuelve a ser POR NEGOCIO (drift de PROD) + sin números repetidos por carrera
--
-- Síntoma (29/09, El Tilo): su primera venta salió #34, después de la #33 de Kalken. Causa verificada el 2026-10-01:
-- en PROD `ventas.numero` es `GENERATED ALWAYS AS IDENTITY` (secuencia `ventas_numero_seq`, global para todos los
-- negocios); en DEV no lo es. La identidad llena `numero` ANTES de los triggers, así que `gen_venta_numero` (que numera
-- por negocio con MAX + 1 solo `IF NEW.numero IS NULL`) nunca hacía nada. No es un dato fiscal (el número de la factura
-- es `numero_comprobante`), pero cada negocio ve saltos raros y el número delata cuántas ventas hay en la plataforma.
-- Fue el único caso: es la única columna IDENTITY de PROD que DEV no tiene (la otra, `mp_billing_alertas.id`, está en
-- los dos).
--
-- Qué hace:
--   1. Quita la identidad (IF EXISTS: en DEV no hace nada). Desde acá numera el trigger: cada negocio sigue desde SU
--      número más alto (El Tilo 38 → 39, Kalken 33 → 34). Los números ya dados NO se tocan (no se reescribe historia).
--   2. `gen_venta_numero` toma un candado por negocio antes del MAX + 1: dos ventas simultáneas del mismo negocio ya no
--      pueden recibir el mismo número (no hay índice único sobre `numero`, así que la carrera pasaba en silencio).
--      Mismo cuerpo que la versión vigente (md5 idéntico en DEV y PROD, f25b0ff0…) + el candado.

ALTER TABLE public.ventas ALTER COLUMN numero DROP IDENTITY IF EXISTS;

CREATE OR REPLACE FUNCTION public.gen_venta_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Serializa la numeración DENTRO de un negocio (se libera al terminar la transacción). Negocios distintos no se
  -- esperan entre sí.
  PERFORM pg_advisory_xact_lock(hashtext('gen_venta_numero:' || NEW.tenant_id::text));
  IF NEW.numero IS NULL THEN
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id;
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND NEW.numero_sucursal IS NULL THEN
    SELECT COALESCE(MAX(numero_sucursal), 0) + 1 INTO NEW.numero_sucursal
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id;
  END IF;
  IF NEW.estado = 'pendiente' AND NEW.presupuesto_numero IS NULL THEN
    SELECT COALESCE(MAX(presupuesto_numero), 0) + 1 INTO NEW.presupuesto_numero
    FROM ventas
    WHERE tenant_id = NEW.tenant_id AND presupuesto_numero IS NOT NULL;
    IF NEW.sucursal_id IS NOT NULL THEN
      SELECT COALESCE(MAX(presupuesto_numero_sucursal), 0) + 1 INTO NEW.presupuesto_numero_sucursal
      FROM ventas
      WHERE tenant_id = NEW.tenant_id AND sucursal_id = NEW.sucursal_id
        AND presupuesto_numero_sucursal IS NOT NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
