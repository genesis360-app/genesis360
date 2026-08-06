// Filtro por "píldoras" del buscador de /inventario (tab Inventario) — mismo mecanismo que
// /picking (`pickingFiltro.ts`) y /productos (`productosFiltro.ts`), sobre el núcleo genérico de
// `pildorasFiltro.ts`. La unidad atómica es la LÍNEA (LPN): un producto puede tener 0+ líneas en
// distintas ubicaciones, así que "(Ubicación):Depósito Y (LPN):001" tiene que exigir ambos en la
// MISMA línea — no una coincidencia repartida entre líneas distintas del mismo producto.

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
export type CampoInventario = 'producto' | 'sku' | 'codigo' | 'lpn' | 'ubicacion'
export type PildoraInventario = Pildora<CampoInventario>

export const CAMPOS_FILTRO_INVENTARIO: ReadonlyArray<CampoDef<CampoInventario>> = [
  { campo: 'producto', label: 'Producto', aliases: ['nombre', 'prod'] },
  { campo: 'sku', label: 'SKU' },
  { campo: 'codigo', label: 'Código', aliases: ['barras', 'ean', 'codigo_barras'] },
  { campo: 'lpn', label: 'LPN' },
  { campo: 'ubicacion', label: 'Ubicación', aliases: ['ubicación', 'ubic'] },
]

export const parsearPildora = (texto: string): PildoraInventario | null =>
  parsearPildoraCore(texto, CAMPOS_FILTRO_INVENTARIO)
export const operadoresValidosParaCampo = (campo: CampoInventario | 'libre') =>
  operadoresValidosParaCampoCore(campo, CAMPOS_FILTRO_INVENTARIO)
export const formatearPildora = (p: PildoraInventario): string =>
  formatearPildoraCore(p, CAMPOS_FILTRO_INVENTARIO)
export const operadorAjustado = (operador: OperadorFiltro, campoNuevo: CampoInventario | 'libre') =>
  operadorAjustadoCore(operador, campoNuevo, CAMPOS_FILTRO_INVENTARIO)

export interface LineaFiltrable {
  productoNombre: string
  sku: string | null
  codigoBarras: string | null
  lpn: string | null
  ubicacionNombre: string | null
}

export function evaluarPildoraLinea(l: LineaFiltrable, p: PildoraInventario): boolean {
  if (p.campo === 'libre') {
    const buscado = p.valor.trim().toLowerCase()
    if (!buscado) return true
    return l.productoNombre.toLowerCase().includes(buscado)
      || (l.sku ?? '').toLowerCase().includes(buscado)
      || (l.codigoBarras ?? '').toLowerCase().includes(buscado)
      || (l.lpn ?? '').toLowerCase().includes(buscado)
      || (l.ubicacionNombre ?? '').toLowerCase().includes(buscado)
  }
  switch (p.campo) {
    case 'producto': return coincideValor(l.productoNombre, p.operador, p.valor)
    case 'sku': return coincideValor(l.sku, p.operador, p.valor)
    case 'codigo': return coincideValor(l.codigoBarras, p.operador, p.valor)
    case 'lpn': return coincideValor(l.lpn, p.operador, p.valor)
    case 'ubicacion': return coincideValor(l.ubicacionNombre, p.operador, p.valor)
  }
}

export function evaluarPildorasLinea(
  l: LineaFiltrable, pildoras: ReadonlyArray<PildoraInventario>, combinador: Combinador,
): boolean {
  return evaluarPildorasCore(l, pildoras, combinador, evaluarPildoraLinea)
}

/** Un producto (con 0+ líneas) matchea si ALGUNA de sus líneas matchea TODAS las píldoras
 * activas contra esa misma línea. Sin líneas, se evalúa una línea "vacía" (sin LPN/ubicación) —
 * solo puede matchear por producto/sku/código, igual que un producto sin stock hoy. */
export function productoMatcheaPildoras(
  producto: { nombre: string; sku: string | null; codigoBarras: string | null },
  lineas: ReadonlyArray<{ lpn: string | null; ubicacionNombre: string | null }>,
  pildoras: ReadonlyArray<PildoraInventario>,
  combinador: Combinador,
): boolean {
  const candidatas = lineas.length > 0 ? lineas : [{ lpn: null, ubicacionNombre: null }]
  return candidatas.some(l => evaluarPildorasLinea(
    {
      productoNombre: producto.nombre, sku: producto.sku, codigoBarras: producto.codigoBarras,
      lpn: l.lpn, ubicacionNombre: l.ubicacionNombre,
    },
    pildoras, combinador,
  ))
}
