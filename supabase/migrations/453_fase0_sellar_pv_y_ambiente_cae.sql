-- 453 — Fase 0 de "Empezar de cero" (REGLA #0): la factura guarda su PUNTO DE VENTA y el AMBIENTE de su CAE,
--        y los campos fiscales dejan de poder escribirse desde el navegador.
--
-- Hallazgos (plan_empezar_de_cero.md + incidente El Tilo 29/09):
--   1. `ventas` no guardaba en qué punto de venta se emitió la factura. La NC armaba `CbtesAsoc.PtoVta` con el PV de
--      la NC (supuesto "single-PV") y el PDF imprimía el PRIMER PV del emisor. Con 2+ PV por CUIT, la NC podía
--      referenciar un comprobante equivocado ante ARCA y el PDF mostrar otro número.
--   2. Ni `ventas` ni `devoluciones` guardaban si el CAE es de homologación o de producción: un CAE de prueba y uno
--      real se ven iguales. "Empezar de cero" (EC-3) solo puede reiniciar mientras no haya un CAE REAL.
--   3. 🛑 `authenticated` tenía UPDATE sobre `ventas.cae/numero_comprobante/tipo_comprobante/emisor_id` y
--      `devoluciones.nc_cae/nc_punto_venta` sin ningún guard: cualquier usuario del negocio podía borrar o cambiar un
--      CAE ya autorizado por ARCA (borrarlo deja re-facturar la venta = doble factura). Verificado: ni la app ni
--      ninguna función de la base escriben esas columnas; solo la EF `emitir-factura` (service_role).
--
-- Qué hace:
--   · `ventas.punto_venta`, `ventas.cae_ambiente`, `devoluciones.nc_cae_ambiente` — los escribe `emitir-factura` al
--     emitir. Las filas existentes quedan NULL = "desconocido" y se tratan como REALES (criterio conservador; REGLA #0
--     punto 7: no se reescribe historia fiscal, no hay backfill).
--   · Trigger `fn_guard_campos_fiscales` en ventas y devoluciones: para los roles del navegador (authenticated / anon)
--     los campos del comprobante son de solo lectura. La EF (service_role) y las funciones SECURITY DEFINER (dueño
--     postgres) siguen pudiendo. Una venta que todavía NO tiene CAE conserva su emisor/tipo editables (hoy nadie los
--     escribe desde el navegador, pero no se cierra lo que no hace falta).

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS punto_venta  integer,
  ADD COLUMN IF NOT EXISTS cae_ambiente text;
ALTER TABLE public.devoluciones
  ADD COLUMN IF NOT EXISTS nc_cae_ambiente text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ventas_cae_ambiente_check') THEN
    ALTER TABLE public.ventas ADD CONSTRAINT ventas_cae_ambiente_check
      CHECK (cae_ambiente IS NULL OR cae_ambiente IN ('homologacion', 'produccion'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devoluciones_nc_cae_ambiente_check') THEN
    ALTER TABLE public.devoluciones ADD CONSTRAINT devoluciones_nc_cae_ambiente_check
      CHECK (nc_cae_ambiente IS NULL OR nc_cae_ambiente IN ('homologacion', 'produccion'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ventas_punto_venta_check') THEN
    ALTER TABLE public.ventas ADD CONSTRAINT ventas_punto_venta_check
      CHECK (punto_venta IS NULL OR punto_venta BETWEEN 1 AND 99998);
  END IF;
END $$;

COMMENT ON COLUMN public.ventas.punto_venta IS
  'Punto de venta ARCA en que se emitió la factura (mig 453, lo escribe emitir-factura). NULL = factura anterior a la mig 453 o sin factura.';
COMMENT ON COLUMN public.ventas.cae_ambiente IS
  'homologacion | produccion — ambiente ARCA del CAE (mig 453). NULL con CAE = desconocido: tratar como REAL.';
COMMENT ON COLUMN public.devoluciones.nc_cae_ambiente IS
  'homologacion | produccion — ambiente ARCA del CAE de la NC (mig 453). NULL con CAE = desconocido: tratar como REAL.';

CREATE OR REPLACE FUNCTION public.fn_guard_campos_fiscales()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_campo text;
BEGIN
  -- Solo los roles del navegador. service_role (EF) y postgres (SECURITY DEFINER, soporte) pasan.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ventas' THEN
    IF TG_OP = 'INSERT' THEN
      v_campo := CASE
        WHEN NEW.cae IS NOT NULL                 THEN 'cae'
        WHEN NEW.vencimiento_cae IS NOT NULL     THEN 'vencimiento_cae'
        WHEN NEW.numero_comprobante IS NOT NULL  THEN 'numero_comprobante'
        WHEN NEW.punto_venta IS NOT NULL         THEN 'punto_venta'
        WHEN NEW.cae_ambiente IS NOT NULL        THEN 'cae_ambiente'
        WHEN NEW.afip_provider_usado IS NOT NULL THEN 'afip_provider_usado'
      END;
    ELSE
      v_campo := CASE
        WHEN NEW.cae IS DISTINCT FROM OLD.cae                                 THEN 'cae'
        WHEN NEW.vencimiento_cae IS DISTINCT FROM OLD.vencimiento_cae         THEN 'vencimiento_cae'
        WHEN NEW.numero_comprobante IS DISTINCT FROM OLD.numero_comprobante   THEN 'numero_comprobante'
        WHEN NEW.punto_venta IS DISTINCT FROM OLD.punto_venta                 THEN 'punto_venta'
        WHEN NEW.cae_ambiente IS DISTINCT FROM OLD.cae_ambiente               THEN 'cae_ambiente'
        WHEN NEW.afip_provider_usado IS DISTINCT FROM OLD.afip_provider_usado THEN 'afip_provider_usado'
        -- Con la factura ya emitida, tampoco su letra ni el CUIT emisor.
        WHEN OLD.cae IS NOT NULL AND NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante THEN 'tipo_comprobante'
        WHEN OLD.cae IS NOT NULL AND NEW.emisor_id IS DISTINCT FROM OLD.emisor_id               THEN 'emisor_id'
      END;
    END IF;
  ELSE  -- devoluciones
    IF TG_OP = 'INSERT' THEN
      v_campo := CASE
        WHEN NEW.nc_cae IS NOT NULL                THEN 'nc_cae'
        WHEN NEW.nc_vencimiento_cae IS NOT NULL    THEN 'nc_vencimiento_cae'
        WHEN NEW.nc_numero_comprobante IS NOT NULL THEN 'nc_numero_comprobante'
        WHEN NEW.nc_tipo IS NOT NULL               THEN 'nc_tipo'
        WHEN NEW.nc_punto_venta IS NOT NULL        THEN 'nc_punto_venta'
        WHEN NEW.nc_fecha IS NOT NULL              THEN 'nc_fecha'
        WHEN NEW.nc_cae_ambiente IS NOT NULL       THEN 'nc_cae_ambiente'
        WHEN NEW.afip_provider_usado IS NOT NULL   THEN 'afip_provider_usado'
      END;
    ELSE
      v_campo := CASE
        WHEN NEW.nc_cae IS DISTINCT FROM OLD.nc_cae                               THEN 'nc_cae'
        WHEN NEW.nc_vencimiento_cae IS DISTINCT FROM OLD.nc_vencimiento_cae       THEN 'nc_vencimiento_cae'
        WHEN NEW.nc_numero_comprobante IS DISTINCT FROM OLD.nc_numero_comprobante THEN 'nc_numero_comprobante'
        WHEN NEW.nc_tipo IS DISTINCT FROM OLD.nc_tipo                             THEN 'nc_tipo'
        WHEN NEW.nc_punto_venta IS DISTINCT FROM OLD.nc_punto_venta               THEN 'nc_punto_venta'
        WHEN NEW.nc_fecha IS DISTINCT FROM OLD.nc_fecha                           THEN 'nc_fecha'
        WHEN NEW.nc_cae_ambiente IS DISTINCT FROM OLD.nc_cae_ambiente             THEN 'nc_cae_ambiente'
        WHEN NEW.afip_provider_usado IS DISTINCT FROM OLD.afip_provider_usado     THEN 'afip_provider_usado'
      END;
    END IF;
  END IF;

  IF v_campo IS NOT NULL THEN
    RAISE EXCEPTION 'El campo fiscal "%" solo lo escribe la emisión del comprobante ante ARCA; no se puede cargar ni modificar a mano.', v_campo
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_campos_fiscales() IS
  'REGLA #0 (mig 453): los campos del comprobante ARCA de ventas/devoluciones son de solo lectura para authenticated/anon; los escribe solo emitir-factura (service_role).';

DROP TRIGGER IF EXISTS trg_ventas_guard_fiscal ON public.ventas;
CREATE TRIGGER trg_ventas_guard_fiscal
  BEFORE INSERT OR UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_campos_fiscales();

DROP TRIGGER IF EXISTS trg_devoluciones_guard_fiscal ON public.devoluciones;
CREATE TRIGGER trg_devoluciones_guard_fiscal
  BEFORE INSERT OR UPDATE ON public.devoluciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_campos_fiscales();
