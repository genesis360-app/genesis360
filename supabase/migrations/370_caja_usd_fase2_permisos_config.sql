-- Migration 370: Fase 2 (permisos y configuración) del plan "Caja en USD" (relevamiento G5).
-- Continúa la Fase 1 (mig 368/369, cimientos de datos). Ver G360.Wiki/wiki/development/reglas-negocio.md
-- y el Artifact de la sesión (plan de 8 fases) para el detalle completo.
--
-- Esta migración es SOLO cimiento de configuración: agrega columnas nullable/default-seguro.
-- NO cambia ningún comportamiento existente por sí sola — cada columna recién se lee cuando el
-- código de esta misma sesión (useCotizacion.ts, ConfigPage.tsx, ProductoFormPage.tsx) la consuma.
-- Aditiva, sin DDL destructivo, sin backfill (todo tenant existente arranca en el default más
-- restrictivo/seguro: NULL = solo DUEÑO, igual que el patrón ya usado por caja_fuerte_roles).

-- 1) Cotización: hoy `tenants.cotizacion_usd` guarda un único valor (venta) sin registrar de qué
--    "casa" (blue/oficial/bolsa/cripto) vino, y CUALQUIER usuario con sidebar puede editarlo o
--    elegir la casa (CotizacionWidget no tiene gate de rol). Se agrega:
--    - cotizacion_usd_compra: la pata de compra que la API ya devuelve y hoy se descarta.
--    - cotizacion_usd_casa: qué casa se usó la última vez, para que un rol sin permiso de "elegir"
--      pueda igual refrescar (repetir la misma casa) sin poder cambiarla.
--    - cotizacion_usd_roles_permitidos: roles (además de DUEÑO, siempre permitido) que pueden elegir
--      la casa o cargar un valor manual. NULL = nadie más que DUEÑO (default más restrictivo).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cotizacion_usd_compra numeric(14,2),
  ADD COLUMN IF NOT EXISTS cotizacion_usd_casa text,
  ADD COLUMN IF NOT EXISTS cotizacion_usd_roles_permitidos jsonb;

-- 2) Caja USD — quién puede operarla (por rol) + umbrales propios en USD, separados de los umbrales
--    en pesos (diferencia_caja_umbral, mismo patrón de mig 203) porque un mismo número no significa
--    lo mismo en ambas monedas. caja_usd_roles_permitidos son roles ADICIONALES a DUEÑO (que siempre
--    puede operar, sea cual sea lo guardado) — mismo criterio "aditivo" que cotizacion_usd_roles_
--    permitidos de arriba. NULL/[] = nadie más que DUEÑO (default más restrictivo).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS caja_usd_roles_permitidos jsonb,
  ADD COLUMN IF NOT EXISTS diferencia_caja_umbral_usd numeric(14,2),
  ADD COLUMN IF NOT EXISTS caja_usd_clave_maestra_umbral numeric(14,2);

-- 3) Producto — checkbox "puede cobrarse en cualquier moneda" (A2 del relevamiento): independiente
--    de moneda_venta (mig 161). Default false preserva el comportamiento actual (un producto solo se
--    cobra en la moneda de su precio de venta) para todo producto existente.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS acepta_cualquier_moneda boolean NOT NULL DEFAULT false;
