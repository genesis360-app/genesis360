// Reglas puras del importador de proveedores (ProveedoresPage → Importar, mig 450).

/** Valores del CHECK `proveedores_condicion_iva_check`. */
export type CondicionIvaProveedor = 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final'

/** Las opciones de la lista desplegable de la plantilla (lo que la persona ve y escribe). */
export const CONDICION_IVA_PLANTILLA = ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final']

const SIN_TILDES = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Condición IVA escrita en el archivo → código de la tabla. Acepta la etiqueta, la sigla (RI, CF) y el código.
 * `null` = vacía; `'invalida'` = trae algo que no se reconoce (no se adivina: decide la letra de las facturas).
 */
export function condicionIvaProveedor(v: unknown): CondicionIvaProveedor | null | 'invalida' {
  const s = SIN_TILDES(String(v ?? '').trim().toLowerCase()).replace(/[\s_.-]+/g, ' ')
  if (!s) return null
  if (['responsable inscripto', 'ri', 'resp inscripto'].includes(s)) return 'responsable_inscripto'
  if (['monotributo', 'monotributista', 'mono', 'responsable monotributo'].includes(s)) return 'monotributo'
  if (['exento', 'iva exento'].includes(s)) return 'exento'
  if (['consumidor final', 'cf'].includes(s)) return 'consumidor_final'
  return 'invalida'
}

/**
 * CBU válido: 22 dígitos y sus dos dígitos verificadores (bloque 1: banco+sucursal; bloque 2: cuenta). Un CBU mal
 * tipeado es plata que va a otra cuenta, así que se valida el dígito y no solo el largo.
 */
export function cbuValido(v: string | null | undefined): boolean {
  const c = String(v ?? '').replace(/\D/g, '')
  if (!/^\d{22}$/.test(c)) return false
  const dv = (digitos: string, pesos: number[]) => {
    const suma = pesos.reduce((acc, p, i) => acc + p * Number(digitos[i]), 0)
    return (10 - (suma % 10)) % 10
  }
  const b1 = c.slice(0, 8), b2 = c.slice(8)
  return dv(b1, [7, 1, 3, 9, 7, 1, 3]) === Number(b1[7]) &&
         dv(b2, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(b2[13])
}

/** "proveedor" | "servicio" (por defecto proveedor). `'invalida'` si trae otra cosa. */
export function tipoProveedor(v: unknown): 'proveedor' | 'servicio' | 'invalida' {
  const s = SIN_TILDES(String(v ?? '').trim().toLowerCase())
  if (!s || s === 'proveedor') return 'proveedor'
  if (s === 'servicio' || s === 'proveedor de servicio') return 'servicio'
  return 'invalida'
}
