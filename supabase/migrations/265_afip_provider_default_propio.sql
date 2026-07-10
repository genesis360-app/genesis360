-- 265: default de tenants.afip_provider pasa a 'propio'
--
-- Decisión GO 2026-07-10: con el circuito WSFE propio ya piloteado y funcionando en PROD
-- (mig 264, ver wiki/features/facturacion-afip.md), y sin clientes reales todavía (todos los
-- tenants existentes son de GO o de Fede, su socio), se usa esta ventana para dogfoodear el
-- circuito propio ampliamente antes de tener clientes reales.
--
-- Este cambio SOLO afecta el DEFAULT para tenants NUEVOS (altas futuras) — no toca las filas
-- existentes (eso se hace aparte, vía UPDATE de datos, no DDL). El flag sigue siendo por-tenant
-- y reversible por flip manual (afip_provider='afipsdk') sin deploy, sin cambios de código.

ALTER TABLE public.tenants ALTER COLUMN afip_provider SET DEFAULT 'propio';
