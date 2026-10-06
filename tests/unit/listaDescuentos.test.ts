import { describe, it, expect } from 'vitest'
import {
  costoConIva, precioConDescuento, margenPct, margenDe, pasaFiltros, agruparPorCategoria, resumenLista, etiquetaFiltro,
  type ProductoLista,
} from '@/lib/listaDescuentos'

const P = (o: Partial<ProductoLista>): ProductoLista => ({
  id: o.id ?? 'p', nombre: 'Bidón 20 L', sku: 'BID-20', marca: 'Ivess', categoriaId: 'agua', categoriaNombre: 'Aguas',
  costo: 50, precioLista: 121, iva: 21, pct: null, ...o,
})

describe('cálculos de la lista', () => {
  it('costo + IVA', () => expect(costoConIva(P({}))).toBe(60.5))
  it('margen = el de la ficha: recargo sobre costo, sin IVA (121 con IVA 21 % = 100 neto sobre 50 → 100 %)', () => {
    expect(margenPct(50, 121, 21)).toBe(100)
    expect(margenDe(P({}))).toBe(100)
  })
  it('el descuento baja el precio y el margen; sin cargar = precio de lista', () => {
    expect(precioConDescuento(P({ pct: 20 }))).toBe(96.8)
    expect(margenDe(P({ pct: 20 }))).toBe(60)
    expect(precioConDescuento(P({ pct: null }))).toBe(121)
  })
  it('aplica el redondeo del negocio igual que el motor', () => {
    expect(precioConDescuento(P({ precioLista: 1234, pct: 10 }), '100')).toBe(1100)
  })
  it('sin costo no hay margen', () => expect(margenDe(P({ costo: 0 }))).toBeNull())
  it('margen negativo cuando el descuento baja del costo', () => expect(margenDe(P({ pct: 60 }))! < 0).toBe(true))
})

describe('filtros (combinables)', () => {
  const ps = [
    P({ id: 'a', nombre: 'Bidón 20 L', marca: 'Ivess', pct: 20 }),
    P({ id: 'b', nombre: 'Soda 2 L', marca: 'Villa', categoriaId: 'soda', categoriaNombre: 'Sodas', precioLista: 60.5, pct: null }),
    P({ id: 'c', nombre: 'Dispenser', marca: '', categoriaId: null, categoriaNombre: 'Sin categoría', costo: 1000, precioLista: 2420, pct: 5 }),
  ]
  const ids = (f: Parameters<typeof pasaFiltros>[1], q = '') => ps.filter(p => pasaFiltros(p, f, q)).map(p => p.id)

  it('buscador por nombre, SKU o marca', () => {
    expect(ids([], 'villa')).toEqual(['b'])
    expect(ids([], 'bid-20')).toEqual(['a', 'b', 'c'])
  })
  it('marca y categoría (multi-valor, "sin marca" = vacío)', () => {
    expect(ids([{ tipo: 'marca', valores: ['Ivess', ''] }])).toEqual(['a', 'c'])
    expect(ids([{ tipo: 'categoria', valores: ['soda'] }])).toEqual(['b'])
  })
  it('numéricos con operadores; el descuento sin cargar cuenta como 0', () => {
    expect(ids([{ tipo: 'descuento', op: '=', valor: 0 }])).toEqual(['b'])
    expect(ids([{ tipo: 'descuento', op: '>=', valor: 5 }])).toEqual(['a', 'c'])
    expect(ids([{ tipo: 'precio', op: '<', valor: 100 }])).toEqual(['a', 'b'])
    expect(ids([{ tipo: 'margen', op: '<=', valor: 0 }])).toEqual(['b'])
  })
  it('varios filtros a la vez = todos se cumplen', () => {
    expect(ids([{ tipo: 'marca', valores: ['Ivess', 'Villa'] }, { tipo: 'descuento', op: '>', valor: 0 }])).toEqual(['a'])
  })
  it('texto de las pastillas', () => {
    expect(etiquetaFiltro({ tipo: 'margen', op: '>=', valor: 30 })).toBe('Margen ≥ 30 %')
    expect(etiquetaFiltro({ tipo: 'precio', op: '<', valor: 1500 })).toBe('Precio de venta < $1.500')
    expect(etiquetaFiltro({ tipo: 'categoria', valores: ['soda'] }, new Map([['soda', 'Sodas']]))).toBe('Categoría: Sodas')
  })
})

describe('agrupado por categoría y cards', () => {
  const ps = [
    P({ id: 'a', categoriaId: 'agua', categoriaNombre: 'Aguas', pct: 10 }),
    P({ id: 'b', categoriaId: 'agua', categoriaNombre: 'Aguas', nombre: 'Agua 6 L', costo: 100, precioLista: 242, pct: 10 }),
    P({ id: 'c', categoriaId: null, categoriaNombre: 'Sin categoría', pct: null }),
  ]
  it('promedios por categoría y % común; "Sin categoría" al final', () => {
    const g = agruparPorCategoria(ps)
    expect(g.map(x => x.nombre)).toEqual(['Aguas', 'Sin categoría'])
    expect(g[0].costoPromedio).toBe(90.75)          // (60,5 + 121) / 2
    expect(g[0].precioPromedio).toBe(163.35)        // (108,9 + 217,8) / 2
    expect(g[0].margenPromedio).toBe(80)            // los dos a 80 %
    expect(g[0].pctComun).toBe(10)
    expect(g[0].pctMixto).toBe(false)
    expect(g[1].pctComun).toBeNull()       // todos sin cargar: "—", no "varios"
    expect(g[1].pctMixto).toBe(false)
    expect(agruparPorCategoria([P({ id: 'x', pct: 5 }), P({ id: 'y', pct: null })])[0].pctMixto).toBe(true)
  })
  it('cards: total, con descuento, % promedio y $ promedio por unidad', () => {
    expect(resumenLista(ps)).toEqual({ totalProductos: 3, conDescuento: 2, pctPromedio: 10, pesosPromedio: 18.15 })
    expect(resumenLista([P({ pct: 0 })])).toEqual({ totalProductos: 1, conDescuento: 0, pctPromedio: null, pesosPromedio: null })
  })
})
