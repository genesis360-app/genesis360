// Tests: lógica de seña en caja (ingreso_reserva / egreso_devolucion_sena)
import { describe, it, expect } from 'vitest'

// ─── Helpers (misma lógica que CajaPage y VentasPage) ─────────────────────────

function calcularSaldoCaja(
  monto_apertura: number,
  movimientos: { tipo: string; monto: number }[],
): number {
  const ingresos = movimientos
    .filter(m => m.tipo === 'ingreso' || m.tipo === 'ingreso_reserva')
    .reduce((a, m) => a + m.monto, 0)
  const egresos = movimientos
    .filter(m => m.tipo === 'egreso' || m.tipo === 'egreso_devolucion_sena')
    .reduce((a, m) => a + m.monto, 0)
  return monto_apertura + ingresos - egresos
}

function extractEfectivoPagado(mediosPagoJson: string | null): number {
  if (!mediosPagoJson) return 0
  try {
    const arr = JSON.parse(mediosPagoJson) as { tipo: string; monto: number }[]
    return arr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
  } catch {
    return 0
  }
}

// ─── calcularSaldoCaja ────────────────────────────────────────────────────────

describe('calcularSaldoCaja', () => {
  it('ingreso_reserva suma al saldo como efectivo real', () => {
    const movs = [
      { tipo: 'ingreso', monto: 1000 },
      { tipo: 'ingreso_reserva', monto: 600 },
    ]
    expect(calcularSaldoCaja(500, movs)).toBe(2100)
  })

  it('egreso_devolucion_sena resta del saldo (devolución al cliente)', () => {
    const movs = [
      { tipo: 'ingreso_reserva', monto: 600 },
      { tipo: 'egreso_devolucion_sena', monto: 600 },
    ]
    expect(calcularSaldoCaja(500, movs)).toBe(500)
  })

  it('ingreso_informativo no afecta el saldo', () => {
    const movs = [{ tipo: 'ingreso_informativo', monto: 1000 }]
    expect(calcularSaldoCaja(500, movs)).toBe(500)
  })

  it('flujo completo: apertura + venta + seña reserva + despacho solo saldo', () => {
    // Apertura $1000
    // Venta $500 (efectivo directo)
    // Seña reserva $300
    // Dispatch del saldo: solo el saldo se agrega (seña ya estaba)
    // Gasto $200
    const movs = [
      { tipo: 'ingreso', monto: 500 },        // venta directa
      { tipo: 'ingreso_reserva', monto: 300 }, // seña registrada al reservar
      { tipo: 'egreso', monto: 200 },          // gasto
    ]
    expect(calcularSaldoCaja(1000, movs)).toBe(1600)
  })
})

// ─── extractEfectivoPagado ────────────────────────────────────────────────────

describe('extractEfectivoPagado', () => {
  it('extrae el monto efectivo de un JSON de medios de pago', () => {
    const json = JSON.stringify([
      { tipo: 'Efectivo', monto: 600 },
      { tipo: 'Tarjeta', monto: 400 },
    ])
    expect(extractEfectivoPagado(json)).toBe(600)
  })

  it('retorna 0 si no hay efectivo (solo tarjeta/MP)', () => {
    const json = JSON.stringify([{ tipo: 'Tarjeta', monto: 1000 }])
    expect(extractEfectivoPagado(json)).toBe(0)
  })

  it('retorna 0 si medio_pago es null', () => {
    expect(extractEfectivoPagado(null)).toBe(0)
  })
})

// ─── calcularDevolucion al cancelar reserva ───────────────────────────────────
// Replica la lógica de VentasPage: egreso_devolucion_sena (efectivo) +
// egreso_informativo (no-efectivo) al cancelar una venta con monto_pagado > 0.

function calcularDevolucion(mediosPagoJson: string | null, montoPagado: number) {
  if (!mediosPagoJson || montoPagado <= 0) return { efectivo: 0, noCash: 0 }
  try {
    const arr = JSON.parse(mediosPagoJson) as { tipo: string; monto: number }[]
    const efectivo = arr.filter(m => m.tipo === 'Efectivo').reduce((s, m) => s + (m.monto ?? 0), 0)
    const noCash = montoPagado - efectivo
    return { efectivo: Math.max(0, efectivo), noCash: Math.max(0, noCash) }
  } catch {
    return { efectivo: 0, noCash: 0 }
  }
}

describe('calcularDevolucion al cancelar reserva', () => {
  it('seña 100% efectivo → devolucion_sena = total, no-cash = 0', () => {
    const json = JSON.stringify([{ tipo: 'Efectivo', monto: 500 }])
    expect(calcularDevolucion(json, 500)).toEqual({ efectivo: 500, noCash: 0 })
  })

  it('seña 100% tarjeta → devolucion_sena = 0, informativo = total', () => {
    const json = JSON.stringify([{ tipo: 'Tarjeta', monto: 500 }])
    expect(calcularDevolucion(json, 500)).toEqual({ efectivo: 0, noCash: 500 })
  })

  it('seña mixta efectivo + tarjeta → split correcto', () => {
    const json = JSON.stringify([{ tipo: 'Efectivo', monto: 300 }, { tipo: 'Tarjeta', monto: 200 }])
    expect(calcularDevolucion(json, 500)).toEqual({ efectivo: 300, noCash: 200 })
  })

  it('seña MP → devolucion_sena = 0, informativo = total', () => {
    const json = JSON.stringify([{ tipo: 'Mercado Pago', monto: 1200 }])
    expect(calcularDevolucion(json, 1200)).toEqual({ efectivo: 0, noCash: 1200 })
  })

  it('sin pago → no devuelve nada', () => {
    expect(calcularDevolucion(null, 0)).toEqual({ efectivo: 0, noCash: 0 })
  })

  it('monto_pagado = 0 aunque haya JSON → no devuelve nada', () => {
    const json = JSON.stringify([{ tipo: 'Efectivo', monto: 0 }])
    expect(calcularDevolucion(json, 0)).toEqual({ efectivo: 0, noCash: 0 })
  })
})
