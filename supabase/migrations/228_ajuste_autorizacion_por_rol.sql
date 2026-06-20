-- Migration 228: autorización de ajustes de inventario POR ROL (configurable)
-- Pedido GO (2026-06-19): el DUEÑO ajusta sin autorización; el resto requiere aprobación;
-- configurable por rol (ej. dejar al SUPERVISOR como el dueño).
--
-- Modos por rol:
--   'directo'  → ajusta sin autorización (aplica al toque).
--   'umbral'   → usa el gate por umbral de conteos (conteo_gate_umbral_*); chico se aplica,
--                grande va a aprobación.
--   'siempre'  → toda diferencia/ajuste va a aprobación, sin importar el monto.
--
-- Guardado como map rol→modo. NULL/sin entrada → DEFAULT en código:
--   DUEÑO = 'directo', cualquier otro rol = 'siempre'.
-- Aplica a diferencias de Conteo y a ajustes directos de cantidad.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ajuste_autorizacion_roles jsonb;

COMMENT ON COLUMN tenants.ajuste_autorizacion_roles IS
  'Map rol→modo (directo|umbral|siempre) para autorización de ajustes de inventario. '
  'NULL o rol ausente → default en código: DUEÑO=directo, resto=siempre.';
