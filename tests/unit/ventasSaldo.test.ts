import { describe, it, expect } from 'vitest'
import { calcularSaldoPendiente, validarSaldoMediosPago, validarDespacho, acumularMediosPago } from '@/lib/ventasValidation'

describe('calcularSaldoPendiente', () => {
  it('retorna 0 cuando ya se pagó todo', () => {
    expect(calcularSaldoPendiente(1000, 1000)).toBe(0)
  })
  it('retorna el saldo cuando se pagó parcialmente', () => {
    expect(calcularSaldoPendiente(1000, 400)).toBe(600)
  })
  it('retorna 0 si monto_pagado supera el total (no negativo)', () => {
    expect(calcularSaldoPendiente(1000, 1200)).toBe(0)
  })
  it('retorna el total si monto_pagado es 0', () => {
    expect(calcularSaldoPendiente(1000, 0)).toBe(1000)
  })
})

describe('validarSaldoMediosPago', () => {
  const saldo = 600

  it('bloquea si no hay ningún medio válido', () => {
    expect(validarSaldoMediosPago([{ tipo: '', monto: '' }], saldo))
      .toBe('Ingresá un método de pago para el saldo')
  })
  it('bloquea si tiene tipo pero no monto', () => {
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '' }], saldo))
      .toBe('Ingresá un método de pago para el saldo')
  })
  it('bloquea si falta cubrir el saldo', () => {
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '500' }], saldo))
      .toContain('Falta asignar')
  })
  it('bloquea si el monto excede el saldo', () => {
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '700' }], saldo))
      .toContain('excede el saldo')
  })
  it('permite con monto exacto', () => {
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '600' }], saldo)).toBeNull()
  })
  it('permite con múltiples medios que suman el saldo', () => {
    const medios = [{ tipo: 'Efectivo', monto: '300' }, { tipo: 'Tarjeta', monto: '300' }]
    expect(validarSaldoMediosPago(medios, saldo)).toBeNull()
  })
  it('tolerancia ±$0.50 permite diferencia mínima', () => {
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '599.6' }], saldo)).toBeNull()
    expect(validarSaldoMediosPago([{ tipo: 'Efectivo', monto: '600.4' }], saldo)).toBeNull()
  })
})

describe('validarDespacho', () => {
  it('bloquea si monto_pagado=0 y no se pasa saldoMediosPago', () => {
    expect(validarDespacho(1000, 0)).toContain('Saldo pendiente')
  })
  it('bloquea si saldo parcialmente cubierto', () => {
    expect(validarDespacho(1000, 400, [{ tipo: 'Efectivo', monto: '400' }])).toContain('Saldo pendiente')
  })
  it('permite si monto_pagado cubre el total', () => {
    expect(validarDespacho(1000, 1000)).toBeNull()
  })
  it('permite si saldoMediosPago cubre el saldo exacto', () => {
    expect(validarDespacho(1000, 0, [{ tipo: 'Efectivo', monto: '1000' }])).toBeNull()
  })
  it('permite si pago original + saldo cubren el total', () => {
    expect(validarDespacho(1000, 400, [{ tipo: 'Efectivo', monto: '600' }])).toBeNull()
  })
  it('permite con tolerancia ±$0.50', () => {
    expect(validarDespacho(1000, 0, [{ tipo: 'Efectivo', monto: '999.6' }])).toBeNull()
  })
  it('bloquea si venta pendiente sin ningún pago (caso real del bug)', () => {
    // venta creada como pendiente sin pagar, monto_pagado=0
    expect(validarDespacho(1500, 0)).toContain('Saldo pendiente')
  })
  it('bloquea si saldoMediosPago vacío/sin tipo', () => {
    expect(validarDespacho(1000, 0, [{ tipo: '', monto: '' }])).toContain('Saldo pendiente')
  })
})

describe('acumularMediosPago', () => {
  it('agrega un medio nuevo al array existente', () => {
    const original = [{ tipo: 'Efectivo', monto: 400 }]
    const saldo = [{ tipo: 'Tarjeta', monto: '600' }]
    const result = acumularMediosPago(original, saldo)
    expect(result).toHaveLength(2)
    expect(result.find(m => m.tipo === 'Tarjeta')?.monto).toBe(600)
  })
  it('suma al medio existente si el tipo es el mismo', () => {
    const original = [{ tipo: 'Efectivo', monto: 400 }]
    const saldo = [{ tipo: 'Efectivo', monto: '600' }]
    const result = acumularMediosPago(original, saldo)
    expect(result).toHaveLength(1)
    expect(result[0].monto).toBe(1000)
  })
  it('ignora entradas sin tipo o monto 0', () => {
    const original = [{ tipo: 'Efectivo', monto: 400 }]
    const saldo = [{ tipo: '', monto: '600' }, { tipo: 'Tarjeta', monto: '0' }]
    const result = acumularMediosPago(original, saldo)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ tipo: 'Efectivo', monto: 400 })
  })
  it('no muta el array original', () => {
    const original = [{ tipo: 'Efectivo', monto: 400 }]
    const originalCopy = JSON.stringify(original)
    acumularMediosPago(original, [{ tipo: 'Efectivo', monto: '100' }])
    expect(JSON.stringify(original)).toBe(originalCopy)
  })
  it('maneja array original vacío', () => {
    const result = acumularMediosPago([], [{ tipo: 'Efectivo', monto: '1000' }])
    expect(result).toEqual([{ tipo: 'Efectivo', monto: 1000 }])
  })
})
