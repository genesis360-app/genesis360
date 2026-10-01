// Padrón de ARCA en el front: llamada a la EF `consultar-cuit` y traducción del resultado al vocabulario de cada
// ficha. El parser y la validación de CUIT son los MISMOS que usa la EF (supabase/functions/_shared/padronArca.ts),
// importados directo para no tener un espejo que se desincronice.
//
// 🛑 REGLA #0 — la condición IVA decide Factura A/B (cliente) o A-B vs C (emisor). Si ARCA no la pudo determinar
// (`condicionIva: null`) no se propone ningún valor: la persona la elige a mano.
import { supabase } from '@/lib/supabase'
import {
  cuitValido,
  normalizarCuit,
  type CondicionIvaPadron,
  type PersonaPadron,
} from '../../supabase/functions/_shared/padronArca'

export { cuitValido, normalizarCuit }
export type { CondicionIvaPadron, PersonaPadron }

export type RespuestaPadron =
  | { ok: true; persona: PersonaPadron; fuente: 'arca' | 'cache'; ambiente: 'homologacion' | 'produccion' }
  | { ok: false; motivo: 'no_existe' | 'error_arca' | 'limite' | 'error'; mensaje: string; ambiente?: string }

export async function consultarCuitArca(cuit: string): Promise<RespuestaPadron> {
  const { data, error } = await supabase.functions.invoke('consultar-cuit', { body: { cuit: normalizarCuit(cuit) } })
  if (error) {
    // 429 = límite de consultas; el resto (red, 5xx) se ofrece cargar a mano.
    const status = (error as { context?: Response }).context?.status
    if (status === 429) return { ok: false, motivo: 'limite', mensaje: 'Se alcanzó el límite de consultas a ARCA. Probá en un rato.' }
    return { ok: false, motivo: 'error', mensaje: 'No se pudo consultar ARCA. Podés cargar los datos a mano.' }
  }
  return data as RespuestaPadron
}

export const CONDICION_PADRON_LABEL: Record<CondicionIvaPadron, string> = {
  RI: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributista',
  EXENTO: 'Exento',
  CF: 'Consumidor Final',
}

/** `clientes.condicion_iva_receptor` (RI / Monotributista / Exento / CF). */
export function condicionParaCliente(c: CondicionIvaPadron | null): string | null {
  if (!c) return null
  return ({ RI: 'RI', MONOTRIBUTO: 'Monotributista', EXENTO: 'Exento', CF: 'CF' } as const)[c]
}

/** `proveedores.condicion_iva` (CHECK: responsable_inscripto / monotributo / exento / consumidor_final). */
export function condicionParaProveedor(c: CondicionIvaPadron | null): string | null {
  if (!c) return null
  return ({ RI: 'responsable_inscripto', MONOTRIBUTO: 'monotributo', EXENTO: 'exento', CF: 'consumidor_final' } as const)[c]
}

/** `condicion_iva_emisor` (RI / Monotributista / Exento). Sin IVA ni monotributo no puede facturar → null. */
export function condicionParaEmisor(c: CondicionIvaPadron | null): string | null {
  if (!c || c === 'CF') return null
  return ({ RI: 'RI', MONOTRIBUTO: 'Monotributista', EXENTO: 'Exento' } as const)[c]
}

/** Un CUIT sin IVA ni monotributo en ARCA no puede facturar: se avisa en la ficha del emisor. */
export function advertenciaEmisor(p: PersonaPadron): string | null {
  return p.condicionIva === 'CF'
    ? 'ARCA no lo registra inscripto en IVA ni en monotributo: con este CUIT no se pueden emitir facturas.'
    : null
}

/** Etiqueta legible de cualquier código de condición IVA de las fichas (cliente, proveedor o emisor). */
export function etiquetaCondicionFicha(v: string): string {
  const m: Record<string, string> = {
    RI: 'Responsable Inscripto', responsable_inscripto: 'Responsable Inscripto',
    Monotributista: 'Monotributista', monotributo: 'Monotributista',
    Exento: 'Exento', exento: 'Exento',
    CF: 'Consumidor Final', consumidor_final: 'Consumidor Final',
  }
  return m[v] ?? v
}
