-- 414 — La cotización con la que un gasto en moneda extranjera entra al Libro IVA
--
-- ⚠️ CRITERIO CONTABLE PENDIENTE DE VALIDAR CON UN CONTADOR REAL. Lo que sigue viene de una
-- consulta a una IA que se presentó como contador matriculado (GO, 2026-09-13) y se adopta como
-- criterio de trabajo mientras tanto. **Antes de que lo use un cliente real hay que confirmarlo.**
--
-- ── Qué dice el criterio ─────────────────────────────────────────────────────────────────────
-- 1. Un gasto en moneda extranjera **SÍ genera crédito fiscal computable** (art. 12 Ley 23.349),
--    si está vinculado a la actividad gravada y tiene comprobante válido con IVA discriminado.
-- 2. La DDJJ va **obligatoriamente en pesos** (art. 96 Ley 11.683): hay que convertir.
-- 3. Tipo de cambio: **BNA VENDEDOR del día hábil ANTERIOR** al perfeccionamiento del hecho
--    imponible (fecha del comprobante). Para **importación de servicios** (reverse charge), el del
--    día hábil anterior al **pago**.
-- 4. El Libro IVA Digital de ARCA exige el campo "tipo de cambio" explícito: sin él, el comprobante
--    queda en "importaciones con avisos" y hay que cargarlo a mano.
--
-- ── Por qué una columna nueva y no reusar la cotización del tenant ───────────────────────────
-- 🛑 **La cotización fiscal NO es la misma que usa el resto del sistema.** Por convención propia,
-- Genesis360 convierte USD→ARS al **dólar COMPRA** (`tenants.cotizacion_usd_compra`), que es lo
-- correcto para valuar lo que el negocio tiene. Lo fiscal pide **BNA VENDEDOR**, y de una fecha
-- concreta — el día hábil anterior al comprobante, no el de hoy. Son dos números distintos y
-- mezclarlos falsea la posición de IVA.
--
-- Además `tenants.cotizacion_usd*` guarda UN valor actual, que cambia. Un gasto de hace tres meses
-- convertido con la cotización de hoy da cualquier cosa. Por eso la tasa se congela EN EL GASTO, el
-- mismo patrón que ya usan `ventas.cotizacion_usd`, `caja_movimientos.cotizacion_usd`,
-- `devoluciones.cotizacion_usd_usada` y `boveda_conversiones_usd.cotizacion_usada`.
--
-- ── Qué NO hace esta migración ───────────────────────────────────────────────────────────────
-- No backfillea nada. Los gastos en moneda extranjera que ya existen quedan **sin** cotización, y
-- el Libro IVA los deja afuera diciendo explícitamente que les falta — inventarles una tasa
-- retroactiva sería fabricar un dato fiscal.

ALTER TABLE public.gastos
  -- Cuántos ARS vale 1 unidad de `gastos.moneda` a efectos fiscales. NULL = sin convertir.
  ADD COLUMN IF NOT EXISTS cotizacion_fiscal numeric(14,4),
  -- A qué día corresponde esa cotización (el día hábil anterior al comprobante, normalmente).
  ADD COLUMN IF NOT EXISTS cotizacion_fiscal_fecha date,
  -- De dónde salió: "BNA vendedor" por defecto, pero queda editable para poder auditar el origen.
  ADD COLUMN IF NOT EXISTS cotizacion_fiscal_fuente text;

-- Una cotización de 0 o negativa no es un dato incompleto: es un dato malo. Mejor rechazarla acá
-- que descubrirla en una posición de IVA.
ALTER TABLE public.gastos
  DROP CONSTRAINT IF EXISTS chk_gastos_cotizacion_fiscal_positiva;
ALTER TABLE public.gastos
  ADD CONSTRAINT chk_gastos_cotizacion_fiscal_positiva
  CHECK (cotizacion_fiscal IS NULL OR cotizacion_fiscal > 0);

COMMENT ON COLUMN public.gastos.cotizacion_fiscal IS
  'ARS por 1 unidad de `moneda`, para convertir el gasto al Libro IVA. Criterio: BNA VENDEDOR del '
  'día hábil anterior al comprobante (o al pago, en importación de servicios). NO es la cotización '
  'operativa del tenant (que va al dólar COMPRA). Se congela por gasto: convertir con la tasa de '
  'hoy un gasto de hace meses da un número que no existe. ⚠️ Criterio pendiente de validación con '
  'un contador matriculado.';
