// Filtro por "píldoras" del buscador de /productos — mismo mecanismo que /picking
// (`pickingFiltro.ts`) y /inventario (`inventarioFiltro.ts`), construido sobre el núcleo
// genérico de `pildorasFiltro.ts`. Reemplaza la búsqueda de texto plano (nombre/SKU/código a la
// vez, ambiguo) por criterios explícitos combinables con un solo Y/O global.

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
export type CampoProducto = 'nombre' | 'sku' | 'codigo'
export type PildoraProducto = Pildora<CampoProducto>

export const CAMPOS_FILTRO_PRODUCTOS: ReadonlyArray<CampoDef<CampoProducto>> = [
  { campo: 'nombre', label: 'Nombre', aliases: ['prod', 'producto'] },
  { campo: 'sku', label: 'SKU' },
  { campo: 'codigo', label: 'Código', aliases: ['barras', 'ean', 'codigo_barras'] },
]

export const parsearPildora = (texto: string): PildoraProducto | null =>
  parsearPildoraCore(texto, CAMPOS_FILTRO_PRODUCTOS)
export const operadoresValidosParaCampo = (campo: CampoProducto | 'libre') =>
  operadoresValidosParaCampoCore(campo, CAMPOS_FILTRO_PRODUCTOS)
export const formatearPildora = (p: PildoraProducto): string =>
  formatearPildoraCore(p, CAMPOS_FILTRO_PRODUCTOS)
export const operadorAjustado = (operador: OperadorFiltro, campoNuevo: CampoProducto | 'libre') =>
  operadorAjustadoCore(operador, campoNuevo, CAMPOS_FILTRO_PRODUCTOS)

export interface ProductoFiltrable {
  nombre: string
  sku: string | null
  codigoBarras: string | null
}

export function evaluarPildoraProducto(p: ProductoFiltrable, pi: PildoraProducto): boolean {
  if (pi.campo === 'libre') {
    const buscado = pi.valor.trim().toLowerCase()
    if (!buscado) return true
    return p.nombre.toLowerCase().includes(buscado)
      || (p.sku ?? '').toLowerCase().includes(buscado)
      || (p.codigoBarras ?? '').toLowerCase().includes(buscado)
  }
  switch (pi.campo) {
    case 'nombre': return coincideValor(p.nombre, pi.operador, pi.valor)
    case 'sku': return coincideValor(p.sku, pi.operador, pi.valor)
    case 'codigo': return coincideValor(p.codigoBarras, pi.operador, pi.valor)
  }
}

export function evaluarPildorasProducto(
  p: ProductoFiltrable, pildoras: ReadonlyArray<PildoraProducto>, combinador: Combinador,
): boolean {
  return evaluarPildorasCore(p, pildoras, combinador, evaluarPildoraProducto)
}
