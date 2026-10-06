/**
 * Número VISIBLE de una orden de compra, según la numeración que eligió el negocio (Configuración → Compras,
 * `tenants.oc_numeracion`, mig 182; default 'sucursal').
 *
 * Una OC tiene dos correlativos que se calculan siempre: `numero` (del negocio) y `numero_sucursal` (de su sucursal).
 * Proveedores mostraba "S-OC-0070" y Gastos, Recepciones, Cheques y Alertas "#84": la MISMA OC con dos números
 * (GO, 2026-10-06). Toda pantalla usa esto, y la base tiene su gemela `fn_oc_etiqueta` (mig 474) para los textos que
 * guarda el servidor (movimientos de la CC del proveedor, gasto de la recepción).
 */
export type NumeracionOC = 'sucursal' | 'tenant' | 'proveedor' | string | null | undefined

export interface OCNumerable {
  numero?: number | null
  numero_sucursal?: number | null
}

/** "S-OC-0070" (numeración por sucursal) o "#84". */
export function etiquetaOC(oc: OCNumerable | null | undefined, numeracion: NumeracionOC = 'sucursal'): string {
  if (!oc) return '—'
  const modo = numeracion ?? 'sucursal'
  if (modo === 'sucursal' && oc.numero_sucursal != null) return `S-OC-${String(oc.numero_sucursal).padStart(4, '0')}`
  return oc.numero != null ? `#${oc.numero}` : '—'
}

/** "OC S-OC-0070" / "OC #84" — el texto completo, como lo muestra Proveedores. */
export function nombreOC(oc: OCNumerable | null | undefined, numeracion?: NumeracionOC): string {
  return `OC ${etiquetaOC(oc, numeracion)}`
}

/** ¿La búsqueda escrita (solo dígitos, o "S-OC-0070") identifica a esta OC? Sirve con cualquiera de los dos números. */
export function ocCoincideNumero(oc: OCNumerable, q: string): boolean {
  const t = q.trim().toUpperCase()
  const m = t.match(/^(?:S-?OC-?)?0*(\d+)$/)
  if (!m) return false
  const n = Number(m[1])
  const pideSucursal = /^S-?OC/.test(t)
  if (pideSucursal) return oc.numero_sucursal === n
  return oc.numero === n || oc.numero_sucursal === n
}
