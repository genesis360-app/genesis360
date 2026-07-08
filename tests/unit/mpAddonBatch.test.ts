/**
 * mpAddonBatch.test.ts — UAT del configurador BATCH con delta (REGLA #0, plata)
 * Fija el contrato de: cálculo por delta preservando descuentos, cobro solo cuando SUBE,
 * y guard de baja a nivel batch (los ejemplos EXACTOS de GO del 2026-07-05).
 * Espejo del EF mp-addon-batch — si cambia el EF, actualizar acá EN EL MISMO cambio.
 */
import { describe, test, expect } from 'vitest'
import {
  calcularBatch, guardBatch, selDesdeAddons, precioSel, esUpgradeDePlan,
  decidirSweepProgramado, decidirConfirmacionCobro,
} from '@/lib/mpAddonBatch'

describe('calcularBatch — delta sobre el monto real (ejemplos GO)', () => {
  test('ejemplo GO 1: Básico $60k + agrega SKU+500 ($5k) → paga $5.000 hoy, recurrente $65.000', () => {
    const r = calcularBatch({ montoActualMP: 60000, packsActuales: {}, packsObjetivo: { sku: 500 } })
    expect(r).toEqual({ recurrenteNuevo: 65000, deltaAPagar: 5000, sinCambios: false, cambiaPlan: false })
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

describe('calcularBatch — cambio de PLAN (Fase 2, spec GO 2026-07-07)', () => {
  // Precios REALES de los planes MP (canal automático −10%): Básico $54k · Pro $90k
  const plan = (tierActual: string, tierObjetivo: string) => ({
    tierActual, tierObjetivo, precioPlanActualMP: 54000, precioPlanObjetivoMP: 90000,
  })

  test('E1: Básico $54k → Pro: delta de plan $36.000 hoy, recurrente $90.000', () => {
    const r = calcularBatch({ montoActualMP: 54000, packsActuales: {}, packsObjetivo: {}, plan: plan('basico', 'pro') })
    expect(r).toEqual({ recurrenteNuevo: 90000, deltaAPagar: 36000, sinCambios: false, cambiaPlan: true })
  })

  test('🛑 preserva descuentos custom: preapproval a $15 (test GO) + upgrade → $36.015, delta $36.000', () => {
    const r = calcularBatch({ montoActualMP: 15, packsActuales: {}, packsObjetivo: {}, plan: plan('basico', 'pro') })
    expect(r.recurrenteNuevo).toBe(36015)
    expect(r.deltaAPagar).toBe(36000)
  })

  test('upgrade + packs en el mismo batch: suma ambos deltas', () => {
    const r = calcularBatch({
      montoActualMP: 59000,                       // Básico $54k + usuarios+1 $5k
      packsActuales: { usuarios: 1 },
      packsObjetivo: { usuarios: 3 },             // pack $10k
      plan: plan('basico', 'pro'),
    })
    expect(r.recurrenteNuevo).toBe(100000)        // 59000 − 5000 + 10000 + 36000
    expect(r.deltaAPagar).toBe(41000)
  })

  test('upgrade + quitar packs puede dar delta ≤ 0 (sin cobro hoy, se aplica ya)', () => {
    const r = calcularBatch({
      montoActualMP: 109000,                      // Básico $54k + sucursales+5 $55k
      packsActuales: { sucursales: 5 },
      packsObjetivo: {},
      plan: plan('basico', 'pro'),
    })
    expect(r.recurrenteNuevo).toBe(90000)
    expect(r.deltaAPagar).toBe(0)
    expect(r.cambiaPlan).toBe(true)
  })

  test('mismo tier objetivo que el actual → NO es cambio de plan (sinCambios si packs iguales)', () => {
    const r = calcularBatch({ montoActualMP: 54000, packsActuales: {}, packsObjetivo: {}, plan: plan('basico', 'basico') })
    expect(r.cambiaPlan).toBe(false)
    expect(r.sinCambios).toBe(true)
  })

  test('esUpgradeDePlan: solo Básico→Pro (downgrade y free/enterprise quedan para MP-P2)', () => {
    expect(esUpgradeDePlan('basico', 'pro')).toBe(true)
    expect(esUpgradeDePlan('pro', 'basico')).toBe(false)
    expect(esUpgradeDePlan('free', 'pro')).toBe(false)
    expect(esUpgradeDePlan('pro', 'pro')).toBe(false)
  })
})

describe('sweep E2 — upgrade programado (espejo mp-batch-sweep, fail-closed)', () => {
  const programadoPara = '2026-08-07T12:00:00Z'

  test('fuera de la ventana (más de 36h antes del cobro) → esperar', () => {
    expect(decidirSweepProgramado({ programadoPara, now: new Date('2026-08-01T12:00:00Z') })).toBe('esperar')
  })

  test('dentro de la ventana previa (36h) → PUT del monto nuevo', () => {
    expect(decidirSweepProgramado({ programadoPara, now: new Date('2026-08-06T12:00:00Z') })).toBe('put')
    expect(decidirSweepProgramado({ programadoPara, now: new Date('2026-08-07T11:00:00Z') })).toBe('put')
  })

  test('pasado el timeout sin procesar (sweep caído >7 días) → vencido (alerta, no PUT a ciegas)', () => {
    expect(decidirSweepProgramado({ programadoPara, now: new Date('2026-08-20T12:00:00Z') })).toBe('vencido')
  })

  test('🛑 el tier se habilita SOLO con cobro aprobado por el monto nuevo', () => {
    expect(decidirConfirmacionCobro({
      preapprovalStatus: 'authorized', cobroAprobadoMonto: 90000, montoEsperado: 90000,
      programadoPara, now: new Date('2026-08-07T13:00:00Z'),
    })).toBe('aplicar')
  })

  test('sin cobro todavía (MP reintenta) → esperar; preapproval cancelado → fallido', () => {
    expect(decidirConfirmacionCobro({
      preapprovalStatus: 'authorized', cobroAprobadoMonto: null, montoEsperado: 90000,
      programadoPara, now: new Date('2026-08-08T12:00:00Z'),
    })).toBe('esperar')
    expect(decidirConfirmacionCobro({
      preapprovalStatus: 'cancelled', cobroAprobadoMonto: null, montoEsperado: 90000,
      programadoPara, now: new Date('2026-08-08T12:00:00Z'),
    })).toBe('fallido')
  })

  test('cobro por el monto VIEJO no habilita el tier (sigue esperando/timeout)', () => {
    expect(decidirConfirmacionCobro({
      preapprovalStatus: 'authorized', cobroAprobadoMonto: 54000, montoEsperado: 90000,
      programadoPara, now: new Date('2026-08-08T12:00:00Z'),
    })).toBe('esperar')
  })

  test('timeout de espera del cobro (7 días) → fallido + conciliación humana', () => {
    expect(decidirConfirmacionCobro({
      preapprovalStatus: 'authorized', cobroAprobadoMonto: null, montoEsperado: 90000,
      programadoPara, now: new Date('2026-08-20T12:00:00Z'),
    })).toBe('fallido')
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
