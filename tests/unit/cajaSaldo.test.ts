import { describe, it, expect } from 'vitest'
import { calcularSaldoEfectivo, cajasSobreUmbralBoveda } from '@/lib/cajaSaldo'

// CAJ-18 — saldo de efectivo: solo cuentan los tipos que mueven efectivo real;
// los *_informativo (no efectivo) no afectan. Usado para impedir caja en negativo.
describe('calcularSaldoEfectivo', () => {
  it('apertura sin movimientos = apertura', () => {
    expect(calcularSaldoEfectivo(1000, [])).toBe(1000)
  })

  it('suma ingresos de efectivo (ingreso, ingreso_reserva, ingreso_traspaso)', () => {
    const saldo = calcularSaldoEfectivo(1000, [
      { tipo: 'ingreso', monto: 500 },
      { tipo: 'ingreso_reserva', monto: 200 },
      { tipo: 'ingreso_traspaso', monto: 300 },
    ])
    expect(saldo).toBe(2000)
  })

  it('resta egresos de efectivo (egreso, egreso_devolucion_sena, egreso_traspaso)', () => {
    const saldo = calcularSaldoEfectivo(2000, [
      { tipo: 'egreso', monto: 500 },
      { tipo: 'egreso_devolucion_sena', monto: 200 },
      { tipo: 'egreso_traspaso', monto: 300 },
    ])
    expect(saldo).toBe(1000)
  })

  it('IGNORA movimientos informativos (no efectivo)', () => {
    const saldo = calcularSaldoEfectivo(1000, [
      { tipo: 'ingreso_informativo', monto: 9999 },
      { tipo: 'egreso_informativo', monto: 9999 },
    ])
    expect(saldo).toBe(1000)
  })

  it('mezcla: apertura + ingresos − egresos, ignorando informativos', () => {
    const saldo = calcularSaldoEfectivo(500, [
      { tipo: 'ingreso', monto: 1000 },        // +1000
      { tipo: 'ingreso_informativo', monto: 800 }, // 0 (tarjeta)
      { tipo: 'egreso', monto: 300 },          // -300
      { tipo: 'egreso_informativo', monto: 50 },   // 0
    ])
    expect(saldo).toBe(1200)
  })

  it('soporta monto como string', () => {
    expect(calcularSaldoEfectivo(0, [{ tipo: 'ingreso', monto: '150.50' }])).toBeCloseTo(150.5)
  })

  it('un egreso puede dejar el saldo en negativo (el guard se hace en el caller, no acá)', () => {
    // La función es pura aritmética; impedir el negativo es responsabilidad del caller (gasto/devolución).
    expect(calcularSaldoEfectivo(100, [{ tipo: 'egreso', monto: 300 }])).toBe(-200)
  })
})

// H4 — alerta no-bloqueante: efectivo en caja sobre el umbral de bóveda
describe('cajasSobreUmbralBoveda', () => {
  const sesiones = [
    { id: 's1', monto_apertura: 1000, caja_nombre: 'Caja 1' },
    { id: 's2', monto_apertura: 500, caja_nombre: 'Caja 2' },
  ]
  const movs = [
    { sesion_id: 's1', tipo: 'ingreso', monto: 60000 },   // s1 = 61000
    { sesion_id: 's2', tipo: 'ingreso', monto: 1000 },     // s2 = 1500
  ]

  it('umbral null/0 → alerta apagada (vacío)', () => {
    expect(cajasSobreUmbralBoveda(sesiones, movs, null)).toEqual([])
    expect(cajasSobreUmbralBoveda(sesiones, movs, 0)).toEqual([])
  })

  it('devuelve solo las cajas cuyo efectivo supera el umbral', () => {
    const r = cajasSobreUmbralBoveda(sesiones, movs, 50000)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ sesionId: 's1', cajaNombre: 'Caja 1', efectivo: 61000 })
  })

  it('ignora los movimientos informativos al calcular el efectivo', () => {
    const r = cajasSobreUmbralBoveda(
      [{ id: 's1', monto_apertura: 0, caja_nombre: 'C' }],
      [{ sesion_id: 's1', tipo: 'ingreso_informativo', monto: 99999 }],
      10000,
    )
    expect(r).toEqual([]) // el efectivo real es 0
  })

  it('justo en el umbral NO alerta (estricto >)', () => {
    expect(cajasSobreUmbralBoveda([{ id: 's1', monto_apertura: 50000 }], [], 50000)).toEqual([])
  })
})
