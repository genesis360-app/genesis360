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
