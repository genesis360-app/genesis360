/**
 * mpAddonBatch.test.ts — UAT del configurador BATCH con delta (REGLA #0, plata)
 * Fija el contrato de: cálculo por delta preservando descuentos, cobro solo cuando SUBE,
 * y guard de baja a nivel batch (los ejemplos EXACTOS de GO del 2026-07-05).
 * Espejo del EF mp-addon-batch — si cambia el EF, actualizar acá EN EL MISMO cambio.
 */
import { describe, test, expect } from 'vitest'
import { calcularBatch, guardBatch, selDesdeAddons, precioSel } from '@/lib/mpAddonBatch'

describe('calcularBatch — delta sobre el monto real (ejemplos GO)', () => {
  test('ejemplo GO 1: Básico $60k + agrega SKU+500 ($5k) → paga $5.000 hoy, recurrente $65.000', () => {
    const r = calcularBatch({ montoActualMP: 60000, packsActuales: {}, packsObjetivo: { sku: 500 } })
    expect(r).toEqual({ recurrenteNuevo: 65000, deltaAPagar: 5000, sinCambios: false })
  })

  test('ejemplo GO 2: venía pagando $65k (Básico + SKU $5k), cambia el pack de SKU a $10k → paga $5.000 hoy, recurrente $70.000', () => {
    const r = calcularBatch({
      montoActualMP: 65000,
      packsActuales: { sku: 500 },     // pack de $5.000
      packsObjetivo: { sku: 2000 },    // pack de $10.000
    })
    expect(r.deltaAPagar).toBe(5000)   // solo la diferencia
    expect(r.recurrenteNuevo).toBe(70000)
  })

  test('baja de un pack → SIN cobro (delta 0) y el recurrente nuevo es lo que llega el mes que viene', () => {
    const r = calcularBatch({ montoActualMP: 70000, packsActuales: { sku: 2000 }, packsObjetivo: { sku: 500 } })
    expect(r.deltaAPagar).toBe(0)      // nunca se cobra ni reembolsa en bajas
    expect(r.recurrenteNuevo).toBe(65000)
  })

  test('🛑 preserva descuentos: preapproval con monto promocional (Fede $1.000) + SKU+500 → $6.000, NO $65.000', () => {
    const r = calcularBatch({ montoActualMP: 1000, packsActuales: {}, packsObjetivo: { sku: 500 } })
    expect(r.recurrenteNuevo).toBe(6000)
    expect(r.deltaAPagar).toBe(5000)
  })

  test('batch mixto (agrega usuarios $5k, quita sucursales $15k) → delta neto negativo = sin cobro', () => {
    const r = calcularBatch({
      montoActualMP: 75000,
      packsActuales: { sucursales: 1 },              // $15.000
      packsObjetivo: { usuarios: 1 },                // $5.000
    })
    expect(r.recurrenteNuevo).toBe(65000)
    expect(r.deltaAPagar).toBe(0)
  })

  test('selección idéntica → sinCambios (el botón se deshabilita)', () => {
    const r = calcularBatch({ montoActualMP: 65000, packsActuales: { sku: 500 }, packsObjetivo: { sku: 500 } })
    expect(r.sinCambios).toBe(true)
    expect(r.deltaAPagar).toBe(0)
  })

  test('packs de comprobantes: +1.000=$10k · +5.000=$30k · +10.000=$50k (precios GO)', () => {
    expect(precioSel({ comprobantes: 1000 })).toBe(10000)
    expect(precioSel({ comprobantes: 5000 })).toBe(30000)
    expect(precioSel({ comprobantes: 10000 })).toBe(50000)
  })

  test('pack fuera de catálogo en el objetivo → precio 0 (no confiable, el EF lo rechaza aparte)', () => {
    expect(precioSel({ sku: 999999 })).toBe(0)
  })
})

describe('guardBatch — baja bloqueada por uso activo (ejemplo GO exacto)', () => {
  const uso = { sku: 2001, sucursales: 1, usuarios: 3 }

  test('🛑 2.001 SKUs activos, Básico(2.000): quitar el pack +2.000 → BLOQUEADO con excedente 1', () => {
    const b = guardBatch({ tier: 'basico', packsObjetivo: {}, uso })
    expect(b).toEqual([{ dimension: 'sku', nuevoLimite: 2000, uso: 2001, excedente: 1 }])
  })

  test('mismo caso pero cambia a +500 (límite 2.500 ≥ 2.001) → PERMITIDO', () => {
    expect(guardBatch({ tier: 'basico', packsObjetivo: { sku: 500 }, uso })).toEqual([])
  })

  test('reporta TODAS las dimensiones en falta (sku y usuarios a la vez)', () => {
    const b = guardBatch({
      tier: 'basico',
      packsObjetivo: {},
      uso: { sku: 2100, sucursales: 1, usuarios: 7 }, // base 5 usuarios, usa 7
    })
    expect(b.map(x => x.dimension).sort()).toEqual(['sku', 'usuarios'])
  })

  test('comprobantes NO tiene guard de baja (es flujo mensual, no estado)', () => {
    const b = guardBatch({ tier: 'basico', packsObjetivo: { comprobantes: 1000 }, uso })
    expect(b.find(x => x.dimension === 'comprobantes')).toBeUndefined()
  })

  test('enterprise (base -1) nunca bloquea', () => {
    expect(guardBatch({ tier: 'enterprise', packsObjetivo: {}, uso: { sku: 99999, sucursales: 99, usuarios: 99 } })).toEqual([])
  })
})

describe('selDesdeAddons — estado inicial del panel', () => {
  test('mapea solo los FIJOS (los temporales de comprobantes no entran al panel batch)', () => {
    const sel = selDesdeAddons([
      { dimension: 'sku', cantidad: 2000, tipo: 'fijo' },
      { dimension: 'comprobantes', cantidad: 1000, tipo: 'temporal' },
      { dimension: 'usuarios', cantidad: 1, tipo: 'fijo' },
    ])
    expect(sel).toEqual({ sku: 2000, usuarios: 1 })
  })
})
