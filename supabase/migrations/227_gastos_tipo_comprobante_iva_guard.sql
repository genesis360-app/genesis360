-- Migration 227: Gastos — tipo_comprobante + guard fiscal de IVA crédito
-- Refactor de automatización fiscal: el crédito de IVA (iva_monto) solo aplica si el
-- tenant es Responsable Inscripto (tenants.condicion_iva_emisor = 'RI') Y el comprobante
-- es 'Factura A'. Monotributista/Exento (y default si no está seteada) → sin crédito de
-- IVA y sin deducción de Ganancias.
--
-- Columnas: solo falta `tipo_comprobante`. `iva_monto` (= crédito de IVA), `alicuota_iva`,
-- `iva_deducible` y `deduce_ganancias` YA existen. `monto_neto` no se agrega (derivable:
-- monto − iva_monto).

-- 1) Nueva columna (nullable, no rompe data existente). También en gastos_fijos
--    (plantillas recurrentes): el form de gasto fijo comparte la sección fiscal y al
--    materializarse en `gastos` copia el tipo_comprobante. El guard fiscal vive solo en
--    `gastos` (la plantilla es estimación; el gasto real generado se sanea al insertarse).
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_comprobante text;
ALTER TABLE gastos_fijos ADD COLUMN IF NOT EXISTS tipo_comprobante text;

-- 2) Backfill: las que ya tenían IVA deducible se asumen Factura A (para que el guard de
--    abajo no les borre el crédito al editarlas). El resto queda NULL (desconocido).
UPDATE gastos
SET tipo_comprobante = 'Factura A'
WHERE tipo_comprobante IS NULL AND iva_deducible IS TRUE;

-- 3) Guard fiscal (BEFORE INSERT/UPDATE): sanea el crédito de IVA y la deducción de
--    Ganancias según la condición del tenant y el comprobante. SECURITY DEFINER para
--    leer tenants sin depender de RLS del rol que dispara.
CREATE OR REPLACE FUNCTION fn_gastos_iva_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cond text;
BEGIN
  SELECT COALESCE(NULLIF(t.condicion_iva_emisor, ''), 'Monotributista')
    INTO v_cond
  FROM tenants t WHERE t.id = NEW.tenant_id;
  v_cond := COALESCE(v_cond, 'Monotributista');

  -- Crédito de IVA solo para RI + Factura A. En cualquier otro caso, sin crédito.
  IF v_cond <> 'RI' OR COALESCE(NEW.tipo_comprobante, '') <> 'Factura A' THEN
    NEW.iva_monto     := NULL;
    NEW.alicuota_iva  := NULL;
    NEW.tipo_iva      := NULL;
    NEW.iva_deducible := false;
  END IF;

  -- Deducción de Ganancias no aplica a Monotributista/Exento.
  IF v_cond <> 'RI' THEN
    NEW.deduce_ganancias := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gastos_iva_guard ON gastos;
CREATE TRIGGER trg_gastos_iva_guard
  BEFORE INSERT OR UPDATE ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_gastos_iva_guard();
