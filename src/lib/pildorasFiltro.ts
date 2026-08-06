// Núcleo genérico del filtro por "píldoras" (campo + operador + valor, combinables con Y/O
// global) — extraído del mecanismo de /picking (`pickingFiltro.ts`) para reusarlo en Productos
// e Inventario. Cada página define su propio set de campos (`CampoDef[]`) y su propio evaluador
// de entidad (la forma de un producto no es la forma de una tarea de picking); acá solo vive el
// parsing "Campo:valor" y el matcher de operadores, que SÍ es igual en las tres pantallas.
//
// `pickingFiltro.ts` NO se migró a depender de este archivo a propósito: es lógica que ya corre
// en producción sobre picking real (WMS) y tiene su propia suite verde — tocarla para dedupe no
// valía el riesgo. Los campos nuevos (Productos/Inventario) sí nacen sobre este núcleo.

export type OperadorFiltro = 'contiene' | 'no_contiene' | 'mayor' | 'menor' | 'mayor_igual' | 'menor_igual'
export type Combinador = 'Y' | 'O'

export interface Pildora<C extends string> {
  id: string
  campo: C | 'libre'
  operador: OperadorFiltro
  valor: string
}

export interface CampoDef<C extends string> {
  campo: C
  label: string
  /** Alias reconocidos al parsear texto libre ("codigo" → sku), en minúsculas. El propio `campo` y `label` ya matchean sin listarlos acá. */
  aliases?: string[]
  numerico?: boolean
}

const OPERADORES_TEXTO: ReadonlyArray<{ operador: OperadorFiltro; simbolo: string }> = [
  { operador: 'contiene', simbolo: ':' },
  { operador: 'no_contiene', simbolo: '≠' },
]
const OPERADORES_NUMERICOS: ReadonlyArray<{ operador: OperadorFiltro; simbolo: string }> = [
  ...OPERADORES_TEXTO,
  { operador: 'mayor', simbolo: '>' },
  { operador: 'menor', simbolo: '<' },
  { operador: 'mayor_igual', simbolo: '≥' },
  { operador: 'menor_igual', simbolo: '≤' },
]
const SIMBOLO_OPERADOR: Record<OperadorFiltro, string> = {
  contiene: ':', no_contiene: '≠', mayor: '>', menor: '<', mayor_igual: '≥', menor_igual: '≤',
}
// Operadores de 2 caracteres ANTES que los de 1 — si no, ">=" matchearía primero como ">" solo.
const OPERADORES_2CH: ReadonlyArray<[string, OperadorFiltro]> = [
  ['>=', 'mayor_igual'], ['<=', 'menor_igual'], ['!=', 'no_contiene'], ['<>', 'no_contiene'],
]
const OPERADORES_1CH: ReadonlyArray<[string, OperadorFiltro]> = [
  [':', 'contiene'], ['=', 'contiene'], ['>', 'mayor'], ['<', 'menor'],
]

function defDe<C extends string>(campo: C | 'libre', campos: ReadonlyArray<CampoDef<C>>): CampoDef<C> | undefined {
  return campos.find(c => c.campo === campo)
}

export function operadoresValidosParaCampo<C extends string>(
  campo: C | 'libre', campos: ReadonlyArray<CampoDef<C>>,
): ReadonlyArray<{ operador: OperadorFiltro; simbolo: string }> {
  return defDe(campo, campos)?.numerico ? OPERADORES_NUMERICOS : OPERADORES_TEXTO
}

export function formatearPildora<C extends string>(p: Pildora<C>, campos: ReadonlyArray<CampoDef<C>>): string {
  if (p.campo === 'libre') return p.valor
  const label = defDe(p.campo, campos)?.label ?? p.campo
  return `(${label})${SIMBOLO_OPERADOR[p.operador]}${p.valor}`
}

/** "Campo:valor" / "campo=valor" / "campo!=valor" / "campo>valor" → Pildora. null si no matchea ningún campo conocido (queda como texto libre). */
export function parsearPildora<C extends string>(texto: string, campos: ReadonlyArray<CampoDef<C>>): Pildora<C> | null {
  const t = texto.trim()
  if (!t) return null
  const alias = new Map<string, C>()
  for (const c of campos) {
    alias.set(c.campo.toLowerCase(), c.campo)
    alias.set(c.label.toLowerCase(), c.campo)
    for (const a of c.aliases ?? []) alias.set(a.toLowerCase(), c.campo)
  }
  for (let i = 1; i < t.length; i++) {
    const dosChars = t.slice(i, i + 2)
    const dos = OPERADORES_2CH.find(([s]) => s === dosChars)
    const campoTxt = t.slice(0, i).trim().toLowerCase().replace(/[()]/g, '')
    const campo = alias.get(campoTxt)
    if (!campo) continue
    if (dos) {
      const valor = t.slice(i + 2).trim()
      if (valor) return { id: crypto.randomUUID(), campo, operador: dos[1], valor }
    }
    const uno = OPERADORES_1CH.find(([s]) => s === t[i])
    if (uno) {
      const valor = t.slice(i + 1).trim()
      if (valor) return { id: crypto.randomUUID(), campo, operador: uno[1], valor }
    }
  }
  return null
}

/** Ajusta el operador si deja de ser válido al cambiar de campo (ej. "mayor" sobre un campo de texto). */
export function operadorAjustado<C extends string>(
  operador: OperadorFiltro, campoNuevo: C | 'libre', campos: ReadonlyArray<CampoDef<C>>,
): OperadorFiltro {
  const validos = operadoresValidosParaCampo(campoNuevo, campos)
  return validos.some(o => o.operador === operador) ? operador : 'contiene'
}

export function coincideValor(
  valorCampo: string | number | null | undefined, operador: OperadorFiltro, valorBuscado: string,
): boolean {
  const buscado = valorBuscado.trim().toLowerCase()
  if (!buscado) return true
  if (operador === 'mayor' || operador === 'menor' || operador === 'mayor_igual' || operador === 'menor_igual') {
    if (valorCampo == null) return false
    const n1 = Number(valorCampo)
    const n2 = Number(buscado)
    if (Number.isNaN(n1) || Number.isNaN(n2)) return false
    if (operador === 'mayor') return n1 > n2
    if (operador === 'menor') return n1 < n2
    if (operador === 'mayor_igual') return n1 >= n2
    return n1 <= n2
  }
  const campoStr = valorCampo == null ? '' : String(valorCampo).toLowerCase()
  const contiene = campoStr.includes(buscado)
  return operador === 'no_contiene' ? !contiene : contiene
}

export function evaluarPildoras<T, C extends string>(
  entidad: T,
  pildoras: ReadonlyArray<Pildora<C>>,
  combinador: Combinador,
  evaluarUna: (entidad: T, p: Pildora<C>) => boolean,
): boolean {
  if (pildoras.length === 0) return true
  const evals = pildoras.map(p => evaluarUna(entidad, p))
  return combinador === 'Y' ? evals.every(Boolean) : evals.some(Boolean)
}
