/**
 * rebajeSort.test.ts
 * Tests unitarios para getRebajeSort — función pura de ordenamiento de inventario.
 */
import { describe, test, expect } from 'vitest'
import { getRebajeSort } from '@/lib/rebajeSort'

// Líneas de inventario de prueba
const linea = (opts: {
  created_at: string
  prioridad?: number
  fecha_vencimiento?: string | null
  estado_id?: string | null
}) => ({
  created_at: opts.created_at,
  fecha_vencimiento: opts.fecha_vencimiento ?? null,
  estado_id: opts.estado_id ?? null,
  ubicaciones: { prioridad: opts.prioridad ?? 0 },
})

const LINEAS = [
  linea({ created_at: '2024-01-01', prioridad: 2 }),   // vieja, prioridad alta (número)
  linea({ created_at: '2024-03-01', prioridad: 0 }),   // nueva, prioridad baja
  linea({ created_at: '2024-02-01', prioridad: 1 }),   // media
]

describe('getRebajeSort — jerarquía de reglas', () => {
  test('usa regla del SKU sobre la del negocio', () => {
    const sort = getRebajeSort('LIFO', 'FIFO', false)
    // Si la función ordena LIFO, las líneas más nuevas van primero
    const sorted = [...LINEAS].sort(sort)
    // Prioridad 0 primero, luego dentro de esa prioridad el más nuevo
    expect(sorted[0].ubicaciones.prioridad).toBe(0)
  })

  test('usa regla del negocio cuando no hay override de SKU', () => {
    const sortFifo = getRebajeSort(null, 'FIFO', false)
    const sortLifo = getRebajeSort(null, 'LIFO', false)
    // FIFO y LIFO difieren dentro de ítems con la MISMA prioridad
    const mismaP = [
      linea({ created_at: '2024-01-01', prioridad: 1 }),
      linea({ created_at: '2024-06-01', prioridad: 1 }),
    ]
    const [primeroFifo] = [...mismaP].sort(sortFifo)
    const [primeroLifo] = [...mismaP].sort(sortLifo)
    expect(primeroFifo.created_at).toBe('2024-01-01') // FIFO: más viejo primero
    expect(primeroLifo.created_at).toBe('2024-06-01') // LIFO: más nuevo primero
  })

  test('fallback a FIFO si no hay regla', () => {
    const sort = getRebajeSort(null, null, false)
    const sorted = [...LINEAS].sort(sort)
    // Con prioridades distintas, ordena por prioridad primero
    expect(sorted[0].ubicaciones.prioridad).toBe(0)
    expect(sorted[2].ubicaciones.prioridad).toBe(2)
  })
})

describe('getRebajeSort — FIFO', () => {
  const sort = getRebajeSort('FIFO', null, false)

  test('ordena por prioridad ASC primero', () => {
    const sorted = [...LINEAS].sort(sort)
    expect(sorted[0].ubicaciones.prioridad).toBeLessThanOrEqual(sorted[1].ubicaciones.prioridad)
    expect(sorted[1].ubicaciones.prioridad).toBeLessThanOrEqual(sorted[2].ubicaciones.prioridad)
  })

  test('dentro de misma prioridad, más viejo primero', () => {
    const mismaP = [
      linea({ created_at: '2024-06-01', prioridad: 1 }),
      linea({ created_at: '2024-01-01', prioridad: 1 }),
      linea({ created_at: '2024-03-01', prioridad: 1 }),
    ]
    const sorted = mismaP.sort(sort)
    expect(sorted[0].created_at).toBe('2024-01-01')
    expect(sorted[2].created_at).toBe('2024-06-01')
  })
})

describe('getRebajeSort — LIFO', () => {
  const sort = getRebajeSort('LIFO', null, false)

  test('dentro de misma prioridad, más nuevo primero', () => {
    const mismaP = [
      linea({ created_at: '2024-01-01', prioridad: 0 }),
      linea({ created_at: '2024-06-01', prioridad: 0 }),
      linea({ created_at: '2024-03-01', prioridad: 0 }),
    ]
    const sorted = mismaP.sort(sort)
    expect(sorted[0].created_at).toBe('2024-06-01')
    expect(sorted[2].created_at).toBe('2024-01-01')
  })
})

describe('getRebajeSort — FEFO', () => {
  const lineasConVenc = [
    linea({ created_at: '2024-01-01', fecha_vencimiento: '2025-12-31' }),
    linea({ created_at: '2024-01-01', fecha_vencimiento: '2025-01-01' }),
    linea({ created_at: '2024-01-01', fecha_vencimiento: '2025-06-15' }),
  ]

  test('con vencimiento: ordena por fecha_vencimiento ASC (primero en vencer primero)', () => {
    const sort = getRebajeSort('FEFO', null, true)
    const sorted = [...lineasConVenc].sort(sort)
    expect(sorted[0].fecha_vencimiento).toBe('2025-01-01')
    expect(sorted[2].fecha_vencimiento).toBe('2025-12-31')
  })

  test('sin vencimiento en producto: hace fallback a FIFO', () => {
    const sortFefo = getRebajeSort('FEFO', null, false)
    const sortFifo = getRebajeSort('FIFO', null, false)
    const resFefo = [...LINEAS].sort(sortFefo).map(l => l.created_at)
    const resFifo = [...LINEAS].sort(sortFifo).map(l => l.created_at)
    expect(resFefo).toEqual(resFifo)
  })
})

describe('getRebajeSort — LEFO', () => {
  const lineasConVenc = [
    linea({ created_at: '2024-01-01', fecha_vencimiento: '2025-12-31' }),
    linea({ created_at: '2024-01-01', fecha_vencimiento: '2025-01-01' }),
  ]

  test('con vencimiento: ordena por fecha_vencimiento DESC (último en vencer primero)', () => {
    const sort = getRebajeSort('LEFO', null, true)
    const sorted = [...lineasConVenc].sort(sort)
    expect(sorted[0].fecha_vencimiento).toBe('2025-12-31')
    expect(sorted[1].fecha_vencimiento).toBe('2025-01-01')
  })
})

describe('getRebajeSort — prioridad por estado (Motor de Rotación, Opción 2)', () => {
  test('sin estadoIdsPrioridad, se comporta igual que antes (compatibilidad)', () => {
    const sinPrioridad = getRebajeSort('FIFO', null, false)
    const conPrioridadVacia = getRebajeSort('FIFO', null, false, new Set())
    const conPrioridadNull = getRebajeSort('FIFO', null, false, null)
    expect([...LINEAS].sort(sinPrioridad)).toEqual([...LINEAS].sort(conPrioridadVacia))
    expect([...LINEAS].sort(sinPrioridad)).toEqual([...LINEAS].sort(conPrioridadNull))
  })

  test('la línea en un estado prioritario va primero, aunque la regla normal la pondría después', () => {
    // FIFO pondría primero la más vieja (2024-01-01); la de "Próximo a Vencer" es la más nueva.
    const vieja = linea({ created_at: '2024-01-01', estado_id: null })
    const prioritaria = linea({ created_at: '2024-06-01', estado_id: 'estado-prox-vencer' })
    const sort = getRebajeSort('FIFO', null, false, new Set(['estado-prox-vencer']))
    const sorted = [vieja, prioritaria].sort(sort)
    expect(sorted[0]).toBe(prioritaria)
  })

  test('entre 2 líneas prioritarias, desempata con la regla normal (FIFO)', () => {
    const p1 = linea({ created_at: '2024-03-01', estado_id: 'estado-x' })
    const p2 = linea({ created_at: '2024-01-01', estado_id: 'estado-x' })
    const sort = getRebajeSort('FIFO', null, false, new Set(['estado-x']))
    const sorted = [p1, p2].sort(sort)
    expect(sorted[0]).toBe(p2) // más vieja primero, FIFO normal
  })

  test('ninguna línea en estado prioritario → idéntico a sin el parámetro', () => {
    const sort = getRebajeSort('FIFO', null, false, new Set(['estado-que-no-aparece']))
    const sortBase = getRebajeSort('FIFO', null, false)
    expect([...LINEAS].sort(sort)).toEqual([...LINEAS].sort(sortBase))
  })
})

describe('getRebajeSort — Manual', () => {
  test('ordena únicamente por prioridad ASC', () => {
    const sort = getRebajeSort('Manual', null, false)
    const sorted = [...LINEAS].sort(sort)
    expect(sorted[0].ubicaciones.prioridad).toBe(0)
    expect(sorted[1].ubicaciones.prioridad).toBe(1)
    expect(sorted[2].ubicaciones.prioridad).toBe(2)
  })

  test('sin ubicación se trata como prioridad 999 (va al final)', () => {
    const sinUbicacion = { created_at: '2024-01-01', fecha_vencimiento: null, ubicaciones: null }
    const conUbicacion = linea({ created_at: '2024-01-01', prioridad: 5 })
    const sort = getRebajeSort('Manual', null, false)
    const sorted = [sinUbicacion, conUbicacion].sort(sort)
    expect(sorted[0]).toBe(conUbicacion)
    expect(sorted[1]).toBe(sinUbicacion)
  })
})

// Ubicaciones Globales (UAT §111, GO 2026-10-08): la regla corre sobre "propio + Globales de otras sucursales"; a igualdad,
// primero lo propio. En Manual el desempate propio/ajeno va antes de la fecha de ingreso.
describe('getRebajeSort — stock de otra sucursal en ubicación Global', () => {
  const l = (o: { created_at: string; prioridad?: number; venc?: string | null; otra?: string }) => ({
    created_at: o.created_at,
    fecha_vencimiento: o.venc ?? null,
    ubicaciones: { prioridad: o.prioridad ?? 0 },
    sucursal_otra: o.otra ?? null,
  })

  test('Manual con prioridades iguales: primero la sucursal propia aunque la Global sea más vieja', () => {
    const globalVieja = l({ created_at: '2026-01-01', otra: 'Norte' })
    const propiaNueva = l({ created_at: '2026-06-01' })
    expect([globalVieja, propiaNueva].sort(getRebajeSort(null, 'Manual', false))[0]).toBe(propiaNueva)
  })

  test('Manual: si la Global tiene mejor prioridad, gana la prioridad', () => {
    const global = l({ created_at: '2026-06-01', prioridad: 1, otra: 'Norte' })
    const propia = l({ created_at: '2026-01-01', prioridad: 5 })
    expect([propia, global].sort(getRebajeSort(null, 'Manual', false))[0]).toBe(global)
  })

  test('FIFO: sigue el primero que ingresó, sea propio o de la Global', () => {
    const globalVieja = l({ created_at: '2026-01-01', otra: 'Norte' })
    const propiaNueva = l({ created_at: '2026-06-01' })
    expect([propiaNueva, globalVieja].sort(getRebajeSort(null, 'FIFO', false))[0]).toBe(globalVieja)
  })

  test('FIFO con la misma fecha de ingreso: primero lo propio', () => {
    const global = l({ created_at: '2026-01-01T00:00:00Z', otra: 'Norte' })
    const propia = l({ created_at: '2026-01-01T00:00:00Z' })
    expect([global, propia].sort(getRebajeSort(null, 'FIFO', false))[0]).toBe(propia)
  })

  test('FEFO: vence primero la Global → sale la Global; mismo vencimiento → lo propio', () => {
    const globalVence = l({ created_at: '2026-06-01', venc: '2026-11-01', otra: 'Norte' })
    const propiaVence = l({ created_at: '2026-01-01', venc: '2026-12-01' })
    expect([propiaVence, globalVence].sort(getRebajeSort(null, 'FEFO', true))[0]).toBe(globalVence)
    const g2 = l({ created_at: '2026-01-01', venc: '2026-12-01', otra: 'Norte' })
    expect([g2, propiaVence].sort(getRebajeSort(null, 'FEFO', true))[0]).toBe(propiaVence)
  })

  test('FEFO sin fechas en ninguna: no da NaN, desempata por lo propio', () => {
    const g = l({ created_at: '2026-01-01', otra: 'Norte' })
    const p = l({ created_at: '2026-01-01' })
    expect([g, p].sort(getRebajeSort(null, 'FEFO', true))[0]).toBe(p)
  })
})
