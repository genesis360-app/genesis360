// Filtro por "píldoras" del buscador de Ventas → Historial — mismo mecanismo que /picking,
// /pedidos, /productos e /inventario, sobre el núcleo genérico de `pildorasFiltro.ts` (GO,
// 2026-08-12, mismo pedido que ya se aplicó en Pedidos: "Venta:2" tiene que ser exacto, no traer
// también la venta #12 o la #201).
//
// `numero` es un identificador — igual que en `pedidosFiltro.ts`, los operadores `:`/`=` (que en
// el núcleo genérico significan "contiene") se reinterpretan como igualdad exacta para este campo.

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
export type CampoVenta = 'numero' | 'cliente'
export type PildoraVenta = Pildora<CampoVenta>

export const CAMPOS_FILTRO_VENTAS: ReadonlyArray<CampoDef<CampoVenta>> = [
  { campo: 'numero', label: 'Venta', aliases: ['nro', 'numero', 'venta', 'n'], numerico: true },
  { campo: 'cliente', label: 'Cliente' },
]

export const parsearPildora = (texto: string): PildoraVenta | null =>
  parsearPildoraCore(texto, CAMPOS_FILTRO_VENTAS)
export const operadoresValidosParaCampo = (campo: CampoVenta | 'libre') =>
  operadoresValidosParaCampoCore(campo, CAMPOS_FILTRO_VENTAS)
export const formatearPildora = (p: PildoraVenta): string =>
  formatearPildoraCore(p, CAMPOS_FILTRO_VENTAS)
export const operadorAjustado = (operador: OperadorFiltro, campoNuevo: CampoVenta | 'libre') =>
  operadorAjustadoCore(operador, campoNuevo, CAMPOS_FILTRO_VENTAS)

export interface VentaFiltrable {
  numero: number | null
  clienteNombre: string | null
}

export function evaluarPildoraVenta(v: VentaFiltrable, pi: PildoraVenta): boolean {
  if (pi.campo === 'libre') {
    const buscado = pi.valor.trim().toLowerCase()
    if (!buscado) return true
    return (v.numero?.toString() ?? '').includes(buscado)
      || (v.clienteNombre ?? '').toLowerCase().includes(buscado)
  }
  switch (pi.campo) {
    case 'numero': {
      const buscado = pi.valor.trim()
      if (!buscado) return true
      if (pi.operador === 'contiene') return String(v.numero) === buscado
      if (pi.operador === 'no_contiene') return String(v.numero) !== buscado
      return coincideValor(v.numero, pi.operador, pi.valor)
    }
    case 'cliente': return coincideValor(v.clienteNombre, pi.operador, pi.valor)
  }
}

export function evaluarPildorasVenta(
  v: VentaFiltrable, pildoras: ReadonlyArray<PildoraVenta>, combinador: Combinador,
): boolean {
  return evaluarPildorasCore(v, pildoras, combinador, evaluarPildoraVenta)
}
