import { describe, it, expect } from 'vitest'
import {
  evaluarLimiteCC,
  evaluarMorosidad,
  calcularInteresMora,
  calcularEstadoCC,
  planificarCobranzaFIFO,
  agruparAgingCC,
  EPS_CC,
  type VentaEstadoCC,
  type VentaSaldoFIFO,
  type VentaAgingCC,
} from '@/lib/ccLogic'

// ─────────────────────────────────────────────────────────────────────────────
// evaluarLimiteCC (CL2-B1)
// ─────────────────────────────────────────────────────────────────────────────
describe('evaluarLimiteCC', () => {
  it('sin límite (null) → ok aunque el monto sea enorme', () => {
    expect(evaluarLimiteCC({ deudaTotal: 0, montoCC: 99999, limite: null, politica: 'bloquear' }))
      .toEqual({ supera: false, accion: 'ok' })
  })
  it('límite undefined → ok (tratado como sin límite)', () => {
    expect(evaluarLimiteCC({ deudaTotal: 0, montoCC: 99999, limite: undefined, politica: 'bloquear' }))
      .toEqual({ supera: false, accion: 'ok' })
  })
  it('montoCC <= EPS_CC → ok (no va nada relevante a CC)', () => {
    expect(evaluarLimiteCC({ deudaTotal: 8000, montoCC: EPS_CC, limite: 10000, politica: 'bloquear' }))
      .toEqual({ supera: false, accion: 'ok' })
  })
  it('no supera el límite → ok (política bloquear)', () => {
    // total 9000 <= 10000
    expect(evaluarLimiteCC({ deudaTotal: 8000, montoCC: 1000, limite: 10000, politica: 'bloquear' }))
      .toEqual({ supera: false, accion: 'ok' })
  })
  it('supera con política bloquear → bloquear', () => {
    // total 11000 > 10000
    expect(evaluarLimiteCC({ deudaTotal: 8000, montoCC: 3000, limite: 10000, politica: 'bloquear' }))
      .toEqual({ supera: true, accion: 'bloquear' })
  })
  it('supera con política avisar → avisar', () => {
    expect(evaluarLimiteCC({ deudaTotal: 8000, montoCC: 3000, limite: 10000, politica: 'avisar' }))
      .toEqual({ supera: true, accion: 'avisar' })
  })
  it('supera con política permitir → permitir (acción refleja la política)', () => {
    expect(evaluarLimiteCC({ deudaTotal: 8000, montoCC: 3000, limite: 10000, politica: 'permitir' }))
      .toEqual({ supera: true, accion: 'permitir' })
  })
  it('borde tolerancia: deudaTotal+montoCC == limite+0.5 NO supera', () => {
    // 9999.6 + 0.9 = 10000.5 == 10000 + 0.5 → NO supera
    expect(evaluarLimiteCC({ deudaTotal: 9999.6, montoCC: 0.9, limite: 10000, politica: 'bloquear' }))
      .toEqual({ supera: false, accion: 'ok' })
  })
  it('borde tolerancia: deudaTotal+montoCC > limite+0.5 SÍ supera', () => {
    // 9999.6 + 1 = 10000.6 > 10000.5 → supera
    expect(evaluarLimiteCC({ deudaTotal: 9999.6, montoCC: 1, limite: 10000, politica: 'bloquear' }))
      .toEqual({ supera: true, accion: 'bloquear' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// evaluarMorosidad (CL2-B4)
// ─────────────────────────────────────────────────────────────────────────────
describe('evaluarMorosidad', () => {
  it('deudaVencida <= EPS_CC → ok aunque la política sea bloqueo_total', () => {
    expect(evaluarMorosidad({ deudaVencida: EPS_CC, politica: 'bloqueo_total', modoCC: true }))
      .toBe('ok')
  })
  it('deudaVencida 0.4 (< umbral) → ok', () => {
    expect(evaluarMorosidad({ deudaVencida: 0.4, politica: 'bloqueo_total', modoCC: false }))
      .toBe('ok')
  })
  it('bloqueo_total bloquea aunque NO sea modoCC (venta efectivo)', () => {
    expect(evaluarMorosidad({ deudaVencida: 5000, politica: 'bloqueo_total', modoCC: false }))
      .toBe('bloquear_total')
  })
  it('bloqueo_total bloquea también en modoCC', () => {
    expect(evaluarMorosidad({ deudaVencida: 5000, politica: 'bloqueo_total', modoCC: true }))
      .toBe('bloquear_total')
  })
  it('bloqueo_cc con modoCC=true → bloquear_cc', () => {
    expect(evaluarMorosidad({ deudaVencida: 5000, politica: 'bloqueo_cc', modoCC: true }))
      .toBe('bloquear_cc')
  })
  it('bloqueo_cc con modoCC=false → ok (deja pagar por otro medio)', () => {
    expect(evaluarMorosidad({ deudaVencida: 5000, politica: 'bloqueo_cc', modoCC: false }))
      .toBe('ok')
  })
  it('permitir → ok siempre (con deuda vencida y modoCC)', () => {
    expect(evaluarMorosidad({ deudaVencida: 5000, politica: 'permitir', modoCC: true }))
      .toBe('ok')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// calcularInteresMora (CL2-B3)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularInteresMora', () => {
  it('pct <= 0 → 0', () => {
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 0, diasVencido: 30 })).toBe(0)
    expect(calcularInteresMora({ saldo: 10000, pctMensual: -5, diasVencido: 30 })).toBe(0)
  })
  it('saldo <= EPS_CC → 0', () => {
    expect(calcularInteresMora({ saldo: EPS_CC, pctMensual: 5, diasVencido: 30 })).toBe(0)
    expect(calcularInteresMora({ saldo: 0.3, pctMensual: 5, diasVencido: 30 })).toBe(0)
  })
  it('diasVencido <= 0 → 0 (no vencida o vencimiento futuro)', () => {
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 0 })).toBe(0)
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: -5 })).toBe(0)
  })
  it('caso normal 30 días = 1 mes → 500', () => {
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 30 })).toBe(500)
  })
  it('caso normal 15 días = medio mes → 250', () => {
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 15 })).toBe(250)
  })
  it('caso normal 45 días = 1.5 meses → 750', () => {
    expect(calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 45 })).toBe(750)
  })
  it('redondea a 2 decimales (12345.67 · 3.5% · 20/30 → 287.40)', () => {
    // 12345.67 * 0.035 * (20/30) = 288.0656... → wait, verify below
    const r = calcularInteresMora({ saldo: 12345.67, pctMensual: 3.5, diasVencido: 20 })
    expect(r).toBe(288.07)
  })
  it('idempotente: mismo input → mismo resultado', () => {
    const a = calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 30 })
    const b = calcularInteresMora({ saldo: 10000, pctMensual: 5, diasVencido: 30 })
    expect(a).toBe(b)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// calcularEstadoCC (CL2-B3/B4)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcularEstadoCC', () => {
  const HOY = '2026-06-02'

  it('suma saldo+interés de ventas con saldo>0.5; excluye saldada (saldo<=0.5)', () => {
    const ventas: VentaEstadoCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 50, fecha_vencimiento_cc: '2026-06-01' }, // vencida ayer
      { total: 500, monto_pagado: 500, interes_cc: 0, fecha_vencimiento_cc: '2026-06-01' }, // saldada → excluida
    ]
    expect(calcularEstadoCC(ventas, HOY)).toEqual({ deudaTotal: 1050, deudaVencida: 1050, interesTotal: 50 })
  })

  it('separa deudaVencida por fecha_vencimiento_cc < hoy', () => {
    const ventas: VentaEstadoCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: '2026-06-03' }, // mañana → no vencida
      { total: 2000, monto_pagado: 0, interes_cc: 100, fecha_vencimiento_cc: '2026-06-01' }, // ayer → vencida
    ]
    expect(calcularEstadoCC(ventas, HOY)).toEqual({ deudaTotal: 3100, deudaVencida: 2100, interesTotal: 100 })
  })

  it('excluye estado cancelada aunque tenga saldo', () => {
    const ventas: VentaEstadoCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: '2026-06-01', estado: 'cancelada' },
    ]
    expect(calcularEstadoCC(ventas, HOY)).toEqual({ deudaTotal: 0, deudaVencida: 0, interesTotal: 0 })
  })

  it('cliente sin ventas → todo 0', () => {
    expect(calcularEstadoCC([], HOY)).toEqual({ deudaTotal: 0, deudaVencida: 0, interesTotal: 0 })
  })

  it('venta sin fecha_vencimiento_cc cuenta como deuda no vencida', () => {
    const ventas: VentaEstadoCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: null },
    ]
    expect(calcularEstadoCC(ventas, HOY)).toEqual({ deudaTotal: 1000, deudaVencida: 0, interesTotal: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// planificarCobranzaFIFO (CL2-B5)
// ─────────────────────────────────────────────────────────────────────────────
describe('planificarCobranzaFIFO', () => {
  const V1 = (): VentaSaldoFIFO => ({ id: 'v1', total: 1000, monto_pagado: 0, medio_pago: null })
  const V2 = (): VentaSaldoFIFO => ({ id: 'v2', total: 500, monto_pagado: 0, medio_pago: null })

  it('reparte sobre la primera venta; sobra la segunda intacta', () => {
    const r = planificarCobranzaFIFO([V1(), V2()], 1000, 'Efectivo')
    expect(r.aplicado).toBe(1000)
    expect(r.ventasSaldadas).toBe(1)
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ id: 'v1', nuevoMontoPagado: 1000 })
  })

  it('monto parcial: salda V1 y abona parcial V2', () => {
    const r = planificarCobranzaFIFO([V1(), V2()], 1200, 'Efectivo')
    expect(r.aplicado).toBe(1200)
    expect(r.ventasSaldadas).toBe(1)
    expect(r.updates).toHaveLength(2)
    expect(r.updates[1]).toMatchObject({ id: 'v2', nuevoMontoPagado: 200 })
  })

  it('monto exacto a la deuda total: ambas saldadas', () => {
    const r = planificarCobranzaFIFO([V1(), V2()], 1500, 'Efectivo')
    expect(r.aplicado).toBe(1500)
    expect(r.ventasSaldadas).toBe(2)
  })

  it('monto que supera la deuda total: aplicado = suma de saldos, no el monto', () => {
    const r = planificarCobranzaFIFO([V1(), V2()], 2000, 'Efectivo')
    expect(r.aplicado).toBe(1500) // no sobre-aplica
    expect(r.ventasSaldadas).toBe(2)
  })

  it('respeta el orden recibido (más antigua primero) con monto parcial', () => {
    // input ordenado V1 luego V2; cobro 300 va todo a V1
    const r = planificarCobranzaFIFO([V1(), V2()], 300, 'Efectivo')
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0].id).toBe('v1')
    expect(r.updates[0].nuevoMontoPagado).toBe(300)
  })

  it('venta con saldo bajo umbral (<=0.5) se ignora', () => {
    const v: VentaSaldoFIFO = { id: 'v1', total: 1000, monto_pagado: 999.7, medio_pago: null }
    const r = planificarCobranzaFIFO([v], 500, 'Efectivo')
    expect(r.aplicado).toBe(0)
    expect(r.ventasSaldadas).toBe(0)
    expect(r.updates).toHaveLength(0)
  })

  it('monto <= 0 → early return con updates vacío', () => {
    expect(planificarCobranzaFIFO([V1()], 0, 'Efectivo'))
      .toEqual({ updates: [], aplicado: 0, ventasSaldadas: 0 })
    expect(planificarCobranzaFIFO([V1()], -100, 'Efectivo'))
      .toEqual({ updates: [], aplicado: 0, ventasSaldadas: 0 })
  })

  it('acumula el medio con push (no fusiona) sobre medio_pago previo', () => {
    const v: VentaSaldoFIFO = { id: 'v1', total: 1000, monto_pagado: 600, medio_pago: JSON.stringify([{ tipo: 'Efectivo', monto: 600 }]) }
    const r = planificarCobranzaFIFO([v], 400, 'Transferencia')
    const medios = JSON.parse(r.updates[0].nuevoMedioPago)
    expect(medios).toHaveLength(2)
    expect(medios[0]).toEqual({ tipo: 'Efectivo', monto: 600 })
    expect(medios[1]).toEqual({ tipo: 'Transferencia', monto: 400 })
  })

  it('tolera medio_pago null → array nuevo con el abono', () => {
    const r = planificarCobranzaFIFO([V2()], 500, 'Efectivo')
    const medios = JSON.parse(r.updates[0].nuevoMedioPago)
    expect(medios).toEqual([{ tipo: 'Efectivo', monto: 500 }])
  })

  it('tolera medio_pago corrupto (no parseable) → array reinicia sin romper', () => {
    const v: VentaSaldoFIFO = { id: 'v1', total: 1000, monto_pagado: 0, medio_pago: '{no es json' }
    const r = planificarCobranzaFIFO([v], 400, 'Efectivo')
    const medios = JSON.parse(r.updates[0].nuevoMedioPago)
    expect(medios).toEqual([{ tipo: 'Efectivo', monto: 400 }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// agruparAgingCC (CL6-G1)
// ─────────────────────────────────────────────────────────────────────────────
describe('agruparAgingCC', () => {
  // ahoraMs fijo: 2026-06-02T12:00:00 UTC para que las refs construidas con T12:00:00 cuadren
  const AHORA = new Date('2026-06-02T12:00:00').getTime()
  const DIA = 86400000
  // construye fecha YYYY-MM-DD a "hace N días" desde AHORA (la función agrega T12:00:00)
  const vencHaceDias = (n: number) => {
    const d = new Date(AHORA - n * DIA)
    return d.toISOString().slice(0, 10)
  }

  it('venc hace 10 días → bucket 0-30', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(10), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 1000, '31-60': 0, '61-90': 0, '+90': 0 })
  })

  it('venc hace 45 días → bucket 31-60', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(45), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 0, '31-60': 1000, '61-90': 0, '+90': 0 })
  })

  it('venc hace 75 días → bucket 61-90', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(75), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 0, '31-60': 0, '61-90': 1000, '+90': 0 })
  })

  it('venc hace 120 días → bucket +90', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(120), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 0, '31-60': 0, '61-90': 0, '+90': 1000 })
  })

  it('límite inclusivo: exactamente 30 días → 0-30', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(30), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)['0-30']).toBe(1000)
  })

  it('exactamente 31 días → 31-60', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(31), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)['31-60']).toBe(1000)
  })

  it('excluye condonadas', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(10), created_at: '', condonada: true },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 })
  })

  it('excluye saldadas (saldo <= 0.5)', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 999.7, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(10), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 0, '31-60': 0, '61-90': 0, '+90': 0 })
  })

  it('fallback a created_at cuando no hay fecha_vencimiento_cc', () => {
    const createdHace100 = new Date(AHORA - 100 * DIA).toISOString()
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: null, created_at: createdHace100 },
    ]
    expect(agruparAgingCC(ventas, AHORA)['+90']).toBe(1000)
  })

  it('incluye interés en el saldo (total 1000, pagado 0, interes 200 → 1200)', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 200, fecha_vencimiento_cc: vencHaceDias(10), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)['0-30']).toBe(1200)
  })

  it('3 ventas en buckets distintos acumulan cada una en su bucket', () => {
    const ventas: VentaAgingCC[] = [
      { total: 1000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(10), created_at: '' },
      { total: 2000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(50), created_at: '' },
      { total: 3000, monto_pagado: 0, interes_cc: 0, fecha_vencimiento_cc: vencHaceDias(120), created_at: '' },
    ]
    expect(agruparAgingCC(ventas, AHORA)).toEqual({ '0-30': 1000, '31-60': 2000, '61-90': 0, '+90': 3000 })
  })
})
