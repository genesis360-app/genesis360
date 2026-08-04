// Aprobación de cambio de estado con foto (Fase B backlog Fede 25/7, mig 331/333).
// Lógica pura, sin I/O. Fórmula única — antes duplicada a mano en LpnAccionesModal.tsx (single) e
// InventarioPage.tsx (bulk), con riesgo de que divergiera en el próximo cambio.
//
// Reusa el mismo gate que ajusteAutorizacion.ts (mig 228, gate de CANTIDAD): un estado con
// requiere_aprobacion=true solo exige foto+autorización si el rol del actor está en modo 'siempre'
// para el tenant. El DUEÑO por default queda exento ('directo') — no se autoaprueba un control que
// él mismo configuró, mismo criterio que rige el ajuste de cantidad. Confirmado con GO como
// comportamiento INTENCIONAL (hallazgo H2, 2026-08-03), no un bug.
//
// Espejo server-side: `fn_inventario_estado_aprobacion_guard` (mig 333) replica esta misma regla
// para bloquear un PATCH directo por REST que se salte este control (hallazgo H1).

import { requiereAuthAjuste, type AjusteAutorizacionConfig } from './ajusteAutorizacion'

export interface EstadoInventarioAprobacion {
  requiere_aprobacion?: boolean | null
}

/** ¿Cambiar a este estado requiere foto + autorización de supervisor? */
export function estadoCambioRequiereAprobacion(
  estadoDestino: EstadoInventarioAprobacion | null | undefined,
  rol: string | null | undefined,
  config: AjusteAutorizacionConfig,
): boolean {
  return !!estadoDestino?.requiere_aprobacion && requiereAuthAjuste(rol, config, false)
}
