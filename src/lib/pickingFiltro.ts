// Filtro de tareas de /picking por "píldoras" (campo + operador + valor), combinables con Y/O.
// Pedido de GO: escribir un número de pedido lo tomaba como LPN/SKU/etc. a la vez — acá cada
// criterio queda explícito a qué campo apunta, y varios criterios se combinan con un solo
// combinador global (no árbol de expresiones anidado, no lo pidieron).

export type CampoFiltro = 'libre' | 'lpn' | 'sku' | 'producto' | 'pedido' | 'venta' | 'envio'
export type OperadorFiltro = 'contiene' | 'no_contiene' | 'mayor' | 'menor' | 'mayor_igual' | 'menor_igual'
export type Combinador = 'Y' | 'O'

export interface Pildora {
  id: string
  campo: CampoFiltro
  operador: OperadorFiltro
  valor: string
}

export const CAMPOS_FILTRO: ReadonlyArray<{ campo: Exclude<CampoFiltro, 'libre'>; label: string }> = [
  { campo: 'lpn', label: 'LPN' },
  { campo: 'sku', label: 'SKU' },
  { campo: 'producto', label: 'Producto' },
  { campo: 'pedido', label: 'Pedido' },
  { campo: 'venta', label: 'Venta' },
  { campo: 'envio', label: 'Envío' },
]

const LABEL_CAMPO: Record<CampoFiltro, string> = {
  libre: '',
  lpn: 'LPN', sku: 'SKU', producto: 'Producto', pedido: 'Pedido', venta: 'Venta', envio: 'Envío',
}

const CAMPOS_NUMERICOS: ReadonlySet<CampoFiltro> = new Set(['pedido', 'venta', 'envio'])
export const esCampoNumerico = (campo: CampoFiltro): boolean => CAMPOS_NUMERICOS.has(campo)

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

export function operadoresValidosParaCampo(campo: CampoFiltro): ReadonlyArray<{ operador: OperadorFiltro; simbolo: string }> {
  return esCampoNumerico(campo) ? OPERADORES_NUMERICOS : OPERADORES_TEXTO
}

const SIMBOLO_OPERADOR: Record<OperadorFiltro, string> = {
  contiene: ':', no_contiene: '≠', mayor: '>', menor: '<', mayor_igual: '≥', menor_igual: '≤',
}

export function formatearPildora(p: Pildora): string {
  if (p.campo === 'libre') return p.valor
  return `(${LABEL_CAMPO[p.campo]})${SIMBOLO_OPERADOR[p.operador]}${p.valor}`
}

const ALIAS_CAMPO: Record<string, Exclude<CampoFiltro, 'libre'>> = {
  lpn: 'lpn',
  sku: 'sku', codigo: 'sku', código: 'sku',
  producto: 'producto', prod: 'producto', nombre: 'producto',
  pedido: 'pedido', ped: 'pedido',
  venta: 'venta',
  envio: 'envio', envío: 'envio',
}

// Operadores de 2 caracteres ANTES que los de 1 — si no, ">=" matchearía primero como ">" solo.
const OPERADORES_2CH: ReadonlyArray<[string, OperadorFiltro]> = [
  ['>=', 'mayor_igual'], ['<=', 'menor_igual'], ['!=', 'no_contiene'], ['<>', 'no_contiene'],
]
const OPERADORES_1CH: ReadonlyArray<[string, OperadorFiltro]> = [
  [':', 'contiene'], ['=', 'contiene'], ['>', 'mayor'], ['<', 'menor'],
]

/** "Pedido:20" / "sku=43" / "venta!=12" / "pedido>50" → Pildora. null si no matchea ningún campo conocido. */
export function parsearPildora(texto: string): Pildora | null {
  const t = texto.trim()
  if (!t) return null
  for (let i = 1; i < t.length; i++) {
    const dosChars = t.slice(i, i + 2)
    const dos = OPERADORES_2CH.find(([s]) => s === dosChars)
    const campoTxt = t.slice(0, i).trim().toLowerCase().replace(/[()]/g, '')
    const campo = ALIAS_CAMPO[campoTxt]
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
export function operadorAjustado(operador: OperadorFiltro, campoNuevo: CampoFiltro): OperadorFiltro {
  const validos = operadoresValidosParaCampo(campoNuevo)
  return validos.some(o => o.operador === operador) ? operador : 'contiene'
}

function coincideValor(valorCampo: string | number | null | undefined, operador: OperadorFiltro, valorBuscado: string): boolean {
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

/** Forma mínima de una tarea que este módulo necesita para filtrar — desacoplado del tipo de PickingPage. */
export interface TareaFiltrable {
  lpn_origen: string | null
  productos: { sku?: string | null; nombre?: string | null } | null
  pedidos: { numero: number | null } | null
  envios: { numero: number | null } | null
}

export function evaluarPildora(t: TareaFiltrable, p: Pildora, ventaNumero: number | null | undefined): boolean {
  if (p.campo === 'libre') {
    const buscado = p.valor.trim().toLowerCase()
    if (!buscado) return true
    return (
      (t.lpn_origen?.toLowerCase().includes(buscado) ?? false) ||
      (t.productos?.sku?.toLowerCase().includes(buscado) ?? false) ||
      (t.productos?.nombre?.toLowerCase().includes(buscado) ?? false)
    )
  }
  switch (p.campo) {
    case 'lpn': return coincideValor(t.lpn_origen, p.operador, p.valor)
    case 'sku': return coincideValor(t.productos?.sku ?? null, p.operador, p.valor)
    case 'producto': return coincideValor(t.productos?.nombre ?? null, p.operador, p.valor)
    case 'pedido': return coincideValor(t.pedidos?.numero ?? null, p.operador, p.valor)
    case 'venta': return coincideValor(ventaNumero ?? null, p.operador, p.valor)
    case 'envio': return coincideValor(t.envios?.numero ?? null, p.operador, p.valor)
  }
}

export function evaluarPildoras(
  t: TareaFiltrable,
  pildoras: readonly Pildora[],
  combinador: Combinador,
  ventaNumero: number | null | undefined,
): boolean {
  if (pildoras.length === 0) return true
  const evals = pildoras.map(p => evaluarPildora(t, p, ventaNumero))
  return combinador === 'Y' ? evals.every(Boolean) : evals.some(Boolean)
}
