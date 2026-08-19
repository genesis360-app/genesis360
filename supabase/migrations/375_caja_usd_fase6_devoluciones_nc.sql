-- Migration 375: Fase 6 (Devoluciones/NC con USD) del plan "Caja en USD" (relevamiento G5).
-- Continúa la Fase 5 (migs 373+374, Bóveda ARS/USD). Ver G360.Wiki/wiki/development/reglas-negocio.md
-- (tabla de decisiones G1/G2) y el Artifact de la sesión (plan de 8 fases).
--
-- G1: reintegro en caja de una devolución cobrada en USD, configurable por tenant. Default: la
--     conversión (cuando el cajero elige un medio "Efectivo USD" para devolver) usa la cotización
--     DE HOY (`tenant.cotizacion_usd`). Alternativa configurable: usar la cotización de la VENTA
--     ORIGINAL (`ventas.cotizacion_usd`, mismo criterio que G2), para tenants que prefieren
--     consistencia entre lo que devuelven en caja y lo que declaran en la NC.
-- G2: la NC AFIP usa la cotización de la venta original — ✅ YA CORRECTO por construcción hoy
--     (`devolucion_items.precio_unitario` se copia de `venta_items.subtotal`, que quedó fijo en
--     pesos al momento de la venta original — nunca se recalcula). Sin cambio de código necesario
--     en `emitir-factura`, solo se documenta el invariante con un comentario (ver commit de código).
--
-- No hace falta ningún trigger nuevo: los `caja_movimientos` que esta fase agrega en el flujo de
-- devolución (VentasPage.tsx) ya quedan protegidos por los triggers existentes
-- `fn_validar_moneda_coincide_sesion` (mig 372) y `fn_validar_moneda_coincide_cuenta_origen` (mig 373).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reintegro_usd_cotizacion_original boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.reintegro_usd_cotizacion_original IS
  'G5 Fase 6 (G1): si es true, el reintegro en caja de una devolución vía un medio "Efectivo USD" usa la cotización de la VENTA ORIGINAL (ventas.cotizacion_usd) en vez de la de HOY (default false = usa la de hoy).';

ALTER TABLE public.devoluciones
  ADD COLUMN IF NOT EXISTS monto_usd numeric(14,2),
  ADD COLUMN IF NOT EXISTS cotizacion_usd_usada numeric(14,4);

COMMENT ON COLUMN public.devoluciones.monto_usd IS
  'G5 Fase 6 — dólares reales devueltos, cuando el medio de reintegro fue "Efectivo USD" (NULL si la devolución no tuvo componente USD).';
COMMENT ON COLUMN public.devoluciones.cotizacion_usd_usada IS
  'G5 Fase 6 — cotización efectivamente usada para convertir monto_usd (hoy o de la venta original, según tenants.reintegro_usd_cotizacion_original). NULL si no hubo componente USD.';

-- Defensa en profundidad (sugerencia de migration-reviewer, mismo espíritu que los CHECK de
-- boveda_conversiones_usd en mig 373): ambas columnas van juntas — o las 2 NULL (sin componente
-- USD) o las 2 presentes y positivas, nunca una sola.
-- OJO NULL: `monto_usd > 0` con `cotizacion_usd_usada` NULL da NULL (no `false`) — un CHECK trata
-- NULL como "pasa". Hay que forzar `IS NOT NULL` explícito en cada rama para que el chequeo sea
-- realmente binario (detectado corriendo el INSERT real en DEV antes de confiar en el archivo).
ALTER TABLE public.devoluciones
  ADD CONSTRAINT devoluciones_usd_ambos_o_ninguno CHECK (
    (monto_usd IS NULL AND cotizacion_usd_usada IS NULL) OR
    (monto_usd IS NOT NULL AND monto_usd > 0 AND cotizacion_usd_usada IS NOT NULL AND cotizacion_usd_usada > 0)
  );
