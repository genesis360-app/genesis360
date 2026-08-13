// Filtro por "píldoras" del buscador de /pedidos — mismo mecanismo que /picking, /productos e
// /inventario, construido sobre el núcleo genérico de `pildorasFiltro.ts`. Reemplaza la búsqueda
// de texto plano por N°/referencia/cliente a la vez (GO, 2026-08-12: tipear "2" para buscar el
// pedido N° 2 también traía el 82, el 102... cualquiera que "contuviera" un 2).
//
// `numero` es un identificador, no un campo de texto libre — a diferencia de nombre/SKU/etc. de
// las otras pantallas, acá "Pedido:2" tiene que ser EXACTO (nadie busca "pedidos cuyo número
// contiene 2"). Los operadores `:`/`=` (que en el núcleo genérico significan "contiene") se
// reinterpretan como igualdad exacta solo para este campo; `>`/`<`/`>=`/`<=` siguen siendo
// comparación numérica real.

import {
  type CampoDef, type Pildora, type Combinador, type OperadorFiltro,
  parsearPildora as parsearPildoraCore,
  operadoresValidosParaCampo as operadoresValidosParaCampoCore,
  formatearPildora as formatearPildoraCore,
  operadorAjustado as operadorAjustadoCore,
  coincideValor,
  evaluarPildoras as evaluarPildorasCore,
} from './pildorasFiltro'

export type { Combinador, OperadorFiltro }
export type CampoPedido = 'numero' | 'referencia' | 'cliente'
export type PildoraPedido = Pildora<CampoPedido>

export const CAMPOS_FILTRO_PEDIDOS: ReadonlyArray<CampoDef<CampoPedido>> = [
  { campo: 'numero', label: 'Pedido', aliases: ['nro', 'numero', 'pedido', 'n'], numerico: true },
  { campo: 'referencia', label: 'Referencia', aliases: ['ref'] },
  { campo: 'cliente', label: 'Cliente' },
]

export const parsearPildora = (texto: string): PildoraPedido | null =>
  parsearPildoraCore(texto, CAMPOS_FILTRO_PEDIDOS)
export const operadoresValidosParaCampo = (campo: CampoPedido | 'libre') =>
  operadoresValidosParaCampoCore(campo, CAMPOS_FILTRO_PEDIDOS)
export const formatearPildora = (p: PildoraPedido): string =>
  formatearPildoraCore(p, CAMPOS_FILTRO_PEDIDOS)
export const operadorAjustado = (operador: OperadorFiltro, campoNuevo: CampoPedido | 'libre') =>
  operadorAjustadoCore(operador, campoNuevo, CAMPOS_FILTRO_PEDIDOS)

export interface PedidoFiltrable {
  numero: number
  referencia: string | null
  clienteNombre: string | null
}

export function evaluarPildoraPedido(p: PedidoFiltrable, pi: PildoraPedido): boolean {
  if (pi.campo === 'libre') {
    const buscado = pi.valor.trim().toLowerCase()
    if (!buscado) return true
    return String(p.numero).includes(buscado)
      || (p.referencia ?? '').toLowerCase().includes(buscado)
      || (p.clienteNombre ?? '').toLowerCase().includes(buscado)
  }
  switch (pi.campo) {
    case 'numero': {
      const buscado = pi.valor.trim()
      if (!buscado) return true
      // `:`/`=` del núcleo genérico = "contiene" — para un identificador eso es exacto, no substring.
      if (pi.operador === 'contiene') return String(p.numero) === buscado
      if (pi.operador === 'no_contiene') return String(p.numero) !== buscado
      return coincideValor(p.numero, pi.operador, pi.valor)
    }
    case 'referencia': return coincideValor(p.referencia, pi.operador, pi.valor)
    case 'cliente': return coincideValor(p.clienteNombre, pi.operador, pi.valor)
  }
}

export function evaluarPildorasPedido(
  p: PedidoFiltrable, pildoras: ReadonlyArray<PildoraPedido>, combinador: Combinador,
): boolean {
  return evaluarPildorasCore(p, pildoras, combinador, evaluarPildoraPedido)
}
