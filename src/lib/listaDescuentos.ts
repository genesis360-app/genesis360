// Lista de descuentos de una categoría de clientes: cálculo y filtros de la pantalla (rediseño 2026-10-05, pedido de GO).
// Todo puro y testeado; la pantalla (DescuentosCategoriaPage) solo dibuja.
//
// Margen = el MISMO que la ficha del producto (ProductoFormPage): recargo sobre el costo, sin IVA →
// (precio / (1 + IVA) − costo) / costo × 100. Costo + IVA = costo × (1 + IVA). Precio con descuento = precio de lista ×
// (1 − %), con el redondeo del negocio (el mismo que aplica el motor al vender). "Sin cargar" (null) no es 0 % (C4).
import { redondearPrecio } from '@/lib/precioRedondeo'

export interface ProductoLista {
  id: string
  nombre: string
  sku: string | null
  marca: string | null
  categoriaId: string | null
  categoriaNombre: string
  costo: number
  precioLista: number
  iva: number
  /** % de la categoría de clientes para este producto; null = sin cargar. */
  pct: number | null
}

export type OperadorFiltro = '>' | '<' | '=' | '>=' | '<='
export type CampoNumerico = 'margen' | 'costo' | 'precio' | 'descuento'
export type FiltroLista =
  | { tipo: 'marca' | 'categoria'; valores: string[] }
  | { tipo: CampoNumerico; op: OperadorFiltro; valor: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const costoConIva = (p: ProductoLista) => r2(p.costo * (1 + p.iva / 100))

export function precioConDescuento(p: ProductoLista, redondeo?: string | null): number {
  const pct = p.pct ?? 0
  if (pct <= 0) return p.precioLista
  return redondearPrecio(r2(p.precioLista * (1 - Math.min(100, pct) / 100)), redondeo)
}

/** Recargo sobre el costo, sin IVA (igual que la ficha). null si no hay costo. */
export function margenPct(costo: number, precioFinal: number, iva: number): number | null {
  if (!(costo > 0) || !(precioFinal >= 0)) return null
  const neto = precioFinal / (1 + iva / 100)
  return Math.round(((neto - costo) / costo) * 1000) / 10
}

export const margenDe = (p: ProductoLista, redondeo?: string | null) => margenPct(p.costo, precioConDescuento(p, redondeo), p.iva)

function comparar(a: number, op: OperadorFiltro, b: number): boolean {
  switch (op) {
    case '>': return a > b
    case '<': return a < b
    case '=': return Math.abs(a - b) < 0.005
    case '>=': return a >= b - 0.005
    case '<=': return a <= b + 0.005
  }
}

function valorNumerico(p: ProductoLista, campo: CampoNumerico, redondeo?: string | null): number | null {
  switch (campo) {
    case 'costo': return costoConIva(p)
    case 'precio': return precioConDescuento(p, redondeo)
    case 'margen': return margenDe(p, redondeo)
    case 'descuento': return p.pct ?? 0
  }
}

export function pasaFiltros(p: ProductoLista, filtros: FiltroLista[], busqueda: string, redondeo?: string | null): boolean {
  const q = busqueda.trim().toLowerCase()
  if (q && !p.nombre.toLowerCase().includes(q) && !(p.sku ?? '').toLowerCase().includes(q) && !(p.marca ?? '').toLowerCase().includes(q)) return false
  for (const f of filtros) {
    if ('valores' in f) {
      if (!f.valores.includes(f.tipo === 'marca' ? (p.marca ?? '') : (p.categoriaId ?? ''))) return false
      continue
    }
    const v = valorNumerico(p, f.tipo, redondeo)
    if (v === null || !comparar(v, f.op, f.valor)) return false
  }
  return true
}

export interface GrupoCategoria {
  categoriaId: string | null
  nombre: string
  productos: ProductoLista[]
  costoPromedio: number | null
  precioPromedio: number | null
  margenPromedio: number | null
  /** % común a todos los productos del grupo (para mostrarlo en la fila); null si hay distintos o alguno sin cargar. */
  pctComun: number | null
  /** Los % del grupo no coinciden (la fila muestra "varios"); si todos están sin cargar, es false. */
  pctMixto: boolean
}

const promedio = (xs: number[]) => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null)

export function agruparPorCategoria(productos: ProductoLista[], redondeo?: string | null): GrupoCategoria[] {
  const grupos = new Map<string, ProductoLista[]>()
  for (const p of productos) {
    const k = p.categoriaId ?? ''
    grupos.set(k, [...(grupos.get(k) ?? []), p])
  }
  return [...grupos.entries()].map(([k, ps]) => {
    const margenes = ps.map(p => margenDe(p, redondeo)).filter((m): m is number => m !== null)
    const pcts = new Set(ps.map(p => p.pct))
    return {
      categoriaId: k || null,
      nombre: ps[0].categoriaNombre,
      productos: [...ps].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      costoPromedio: promedio(ps.map(costoConIva)),
      precioPromedio: promedio(ps.map(p => precioConDescuento(p, redondeo))),
      margenPromedio: margenes.length ? Math.round((margenes.reduce((s, m) => s + m, 0) / margenes.length) * 10) / 10 : null,
      pctComun: pcts.size === 1 ? [...pcts][0] : null,
      pctMixto: pcts.size > 1,
    }
  }).sort((a, b) => (a.categoriaId === null ? 1 : b.categoriaId === null ? -1 : a.nombre.localeCompare(b.nombre, 'es')))
}

export interface ResumenLista { totalProductos: number; conDescuento: number; pctPromedio: number | null; pesosPromedio: number | null }

/** Cards: % promedio y $ promedio por unidad (precio de lista × %), entre los productos con descuento (> 0 %). */
export function resumenLista(productos: ProductoLista[]): ResumenLista {
  const con = productos.filter(p => (p.pct ?? 0) > 0)
  return {
    totalProductos: productos.length,
    conDescuento: con.length,
    pctPromedio: con.length ? Math.round((con.reduce((s, p) => s + (p.pct as number), 0) / con.length) * 100) / 100 : null,
    pesosPromedio: con.length ? r2(con.reduce((s, p) => s + p.precioLista * (p.pct as number) / 100, 0) / con.length) : null,
  }
}

const NOMBRE_CAMPO: Record<CampoNumerico, string> = { margen: 'Margen', costo: 'Costo + IVA', precio: 'Precio de venta', descuento: 'Descuento' }
const OP_TEXTO: Record<OperadorFiltro, string> = { '>': '>', '<': '<', '=': '=', '>=': '≥', '<=': '≤' }

/** Texto de la pastilla del filtro. `nombres` traduce ids de categoría a nombre. */
export function etiquetaFiltro(f: FiltroLista, nombres?: Map<string, string>): string {
  if ('valores' in f) {
    return f.tipo === 'marca'
      ? `Marca: ${f.valores.map(v => v || 'sin marca').join(', ')}`
      : `Categoría: ${f.valores.map(v => nombres?.get(v) ?? (v || 'sin categoría')).join(', ')}`
  }
  const unidad = f.tipo === 'margen' || f.tipo === 'descuento' ? ` %` : ''
  const valor = f.tipo === 'costo' || f.tipo === 'precio' ? `$${f.valor.toLocaleString('es-AR')}` : f.valor.toLocaleString('es-AR')
  return `${NOMBRE_CAMPO[f.tipo]} ${OP_TEXTO[f.op]} ${valor}${unidad}`
}
