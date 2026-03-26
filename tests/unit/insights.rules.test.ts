/**
 * insights.rules.test.ts
 * Tests unitarios para las reglas de cálculo de cobertura e insights.
 * Testea la lógica pura extraída de useRecomendaciones.
 */
import { describe, test, expect } from 'vitest'

// ─── Helpers de lógica pura (extraídas de useRecomendaciones) ──────────────

function calcularCobertura(stockActual: number, vendido30d: number): number | null {
  if (vendido30d === 0 || stockActual <= 0) return null
  return stockActual / (vendido30d / 30)
}

function calcularMargenRealizado(items: { precio_unitario: number; precio_costo_historico: number; cantidad: number }[]): number | null {
  const validos = items.filter(i => i.precio_costo_historico > 0 && i.precio_unitario > 0)
  if (validos.length === 0) return null
  const totalFacturado = validos.reduce((a, i) => a + i.precio_unitario * i.cantidad, 0)
  const totalCosto     = validos.reduce((a, i) => a + i.precio_costo_historico * i.cantidad, 0)
  return totalFacturado > 0 ? (totalFacturado - totalCosto) / totalFacturado * 100 : null
}

function detectarDiasFlojos(ventas: { created_at: string; total: number }[], umbral = 0.5): number[] {
  if (ventas.length < 20) return []
  const porDia: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  for (const v of ventas) {
    const dow = new Date(v.created_at).getDay()
    porDia[dow].push(v.total)
  }
  const promPorDia = Object.entries(porDia)
    .filter(([, totales]) => totales.length > 0)
    .map(([dow, totales]) => ({
      dow: Number(dow),
      prom: totales.reduce((a, t) => a + t, 0) / totales.length,
      semanas: totales.length,
    }))
  if (promPorDia.length <= 1) return []
  const promGeneral = promPorDia.reduce((a, d) => a + d.prom, 0) / promPorDia.length
  return promPorDia
    .filter(d => d.prom < promGeneral * umbral && d.semanas >= 4)
    .map(d => d.dow)
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('calcularCobertura', () => {
  test('retorna días correctos', () => {
    // 30 unidades vendidas en 30 días = 1/día. Con 6 en stock = 6 días
    expect(calcularCobertura(6, 30)).toBeCloseTo(6)
  })

  test('retorna null si sin ventas en 30 días', () => {
    expect(calcularCobertura(10, 0)).toBeNull()
  })

  test('retorna null si stock = 0', () => {
    expect(calcularCobertura(0, 30)).toBeNull()
  })

  test('detecta correctamente stock < 3 días', () => {
    // 60 vendidos en 30d = 2/día. 5 en stock = 2.5 días
    const dias = calcularCobertura(5, 60)
    expect(dias).not.toBeNull()
    expect(dias!).toBeLessThan(3)
  })

  test('stock abundante > 3 días no dispara alerta', () => {
    // 10 vendidos en 30d = 0.33/día. 30 en stock = 90 días
    const dias = calcularCobertura(30, 10)
    expect(dias!).toBeGreaterThan(3)
  })
})

describe('calcularMargenRealizado', () => {
  test('calcula margen correctamente', () => {
    const items = [
      { precio_unitario: 1000, precio_costo_historico: 600, cantidad: 1 },
      { precio_unitario: 500,  precio_costo_historico: 300, cantidad: 2 },
    ]
    // Facturado: 1000 + 1000 = 2000. Costo: 600 + 600 = 1200. Margen = (800/2000)*100 = 40%
    expect(calcularMargenRealizado(items)).toBeCloseTo(40)
  })

  test('ignora items sin precio de costo', () => {
    const items = [
      { precio_unitario: 1000, precio_costo_historico: 0, cantidad: 1 },
      { precio_unitario: 500,  precio_costo_historico: 250, cantidad: 1 },
    ]
    // Solo el segundo item vale. Margen = (250/500)*100 = 50%
    expect(calcularMargenRealizado(items)).toBeCloseTo(50)
  })

  test('retorna null si no hay items con costo', () => {
    const items = [
      { precio_unitario: 1000, precio_costo_historico: 0, cantidad: 1 },
    ]
    expect(calcularMargenRealizado(items)).toBeNull()
  })

  test('detecta margen bajo < 15%', () => {
    const items = [
      { precio_unitario: 100, precio_costo_historico: 90, cantidad: 10 },
    ]
    const margen = calcularMargenRealizado(items)
    expect(margen).not.toBeNull()
    expect(margen!).toBeLessThan(15)
  })
})

describe('detectarDiasFlojos', () => {
  test('necesita al menos 20 ventas para detectar', () => {
    const pocasVentas = [{ created_at: '2024-01-01', total: 100 }]
    expect(detectarDiasFlojos(pocasVentas)).toEqual([])
  })

  // Generar ventas donde los lunes (1) tienen ventas muy bajas vs el resto
  test('detecta día con ventas sistemáticamente bajas', () => {
    const ventas: { created_at: string; total: number }[] = []
    // 12 semanas de datos (84 ventas aprox)
    for (let semana = 0; semana < 12; semana++) {
      for (let dia = 0; dia < 7; dia++) {
        const fecha = new Date(2024, 0, 1 + semana * 7 + dia)
        const dow = fecha.getDay()
        // Lunes (1) tiene $10, resto tiene $500
        ventas.push({ created_at: fecha.toISOString(), total: dow === 1 ? 10 : 500 })
      }
    }
    const flojos = detectarDiasFlojos(ventas)
    expect(flojos).toContain(1) // Lunes debe ser detectado como flojo
  })

  test('no detecta días flojos si todos son parejos', () => {
    const ventas: { created_at: string; total: number }[] = []
    for (let semana = 0; semana < 12; semana++) {
      for (let dia = 0; dia < 7; dia++) {
        const fecha = new Date(2024, 0, 1 + semana * 7 + dia)
        ventas.push({ created_at: fecha.toISOString(), total: 500 })
      }
    }
    expect(detectarDiasFlojos(ventas)).toHaveLength(0)
  })
})
