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
  sucursal_id?: string | null
}

// Código de cada sucursal ("SUC1"), para el número visible "OC-SUC1-0070". Lo carga el store de la sesión
// (authStore.subscribe) — así esta librería no importa el store ni la sesión, y los tests la usan suelta.
let codigosSucursal = new Map<string, string>()
export function registrarCodigosSucursal(sucursales: { id: string; codigo?: string | null }[] | null | undefined) {
  codigosSucursal = new Map((sucursales ?? []).filter(s => s.codigo?.trim()).map(s => [s.id, s.codigo!.trim()]))
}

/**
 * "OC-SUC1-0070" (numeración por sucursal, con el código de la sucursal — igual que "PRES-SUC1-0042"), "S-OC-0070" si
 * la sucursal no tiene código, o "#84" (numeración del negocio). Con "S-OC" fijo dos sucursales mostraban la misma
 * etiqueta para OCs distintas (decisión de GO 2026-10-07: sin código no cambia nada, ni para los PDFs ya enviados).
 */
export function etiquetaOC(oc: OCNumerable | null | undefined, numeracion: NumeracionOC = 'sucursal'): string {
  if (!oc) return '—'
  const modo = numeracion ?? 'sucursal'
  if (modo === 'sucursal' && oc.numero_sucursal != null) {
    const n = String(oc.numero_sucursal).padStart(4, '0')
    const codigo = oc.sucursal_id ? codigosSucursal.get(oc.sucursal_id) : undefined
    return codigo ? `OC-${codigo}-${n}` : `S-OC-${n}`
  }
  return oc.numero != null ? `#${oc.numero}` : '—'
}

/** "OC OC-SUC1-0070" / "OC S-OC-0070" / "OC #84" — el texto completo, como lo muestra Proveedores. */
export function nombreOC(oc: OCNumerable | null | undefined, numeracion?: NumeracionOC): string {
  return `OC ${etiquetaOC(oc, numeracion)}`
}

/**
 * ¿La búsqueda escrita (solo dígitos, "S-OC-0070" u "OC-SUC1-0070") identifica a esta OC? Sirve con cualquiera de los
 * dos números. Con código de sucursal, además tiene que ser la sucursal de la OC.
 */
export function ocCoincideNumero(oc: OCNumerable, q: string): boolean {
  const t = q.trim().toUpperCase()
  const conCodigo = t.match(/^OC-(.+)-0*(\d+)$/)
  if (conCodigo && conCodigo[1] !== 'S') {
    const codigo = oc.sucursal_id ? codigosSucursal.get(oc.sucursal_id)?.toUpperCase() : undefined
    return codigo === conCodigo[1] && oc.numero_sucursal === Number(conCodigo[2])
  }
  const m = t.match(/^(?:S-?OC-?)?0*(\d+)$/)
  if (!m) return false
  const n = Number(m[1])
  const pideSucursal = /^S-?OC/.test(t)
  if (pideSucursal) return oc.numero_sucursal === n
  return oc.numero === n || oc.numero_sucursal === n
}
