import { describe, it, expect } from 'vitest'
import {
  estadosSiguientes, puedeTransicionar, puedeEndosar, esEstadoTerminalCheque,
  chequeProximoACobrar, chequeVencido, validarChequeAlta, totalPendiente,
} from '@/lib/comprasCheques'

// Compras CO6 — cheques diferidos

describe('estados terminales', () => {
  it('cobrado/rechazado/anulado son terminales', () => {
    expect(esEstadoTerminalCheque('cobrado')).toBe(true)
    expect(esEstadoTerminalCheque('rechazado')).toBe(true)
    expect(esEstadoTerminalCheque('anulado')).toBe(true)
    expect(esEstadoTerminalCheque('en_cartera')).toBe(false)
  })
})

describe('estadosSiguientes (transiciones)', () => {
  it('propio: en_cartera → entregado/anulado', () => {
    expect(estadosSiguientes('propio', 'en_cartera').sort()).toEqual(['anulado', 'entregado'])
  })
  it('propio: entregado → cobrado/rechazado/anulado', () => {
    expect(estadosSiguientes('propio', 'entregado').sort()).toEqual(['anulado', 'cobrado', 'rechazado'])
  })
  it('tercero: en_cartera → endosado/depositado/anulado', () => {
    expect(estadosSiguientes('tercero', 'en_cartera').sort()).toEqual(['anulado', 'depositado', 'endosado'])
  })
  it('estado terminal no tiene siguientes', () => {
    expect(estadosSiguientes('propio', 'cobrado')).toEqual([])
  })
})

describe('puedeTransicionar', () => {
  it('valida transición permitida', () => {
    expect(puedeTransicionar('propio', 'entregado', 'cobrado')).toBe(true)
    expect(puedeTransicionar('propio', 'en_cartera', 'cobrado')).toBe(false)
    expect(puedeTransicionar('tercero', 'en_cartera', 'endosado')).toBe(true)
  })
})

describe('puedeEndosar', () => {
  it('solo cheque de tercero en cartera', () => {
    expect(puedeEndosar({ tipo: 'tercero', estado: 'en_cartera' })).toBe(true)
    expect(puedeEndosar({ tipo: 'tercero', estado: 'endosado' })).toBe(false)
    expect(puedeEndosar({ tipo: 'propio', estado: 'en_cartera' })).toBe(false)
  })
})

describe('chequeProximoACobrar (D4 alerta)', () => {
  it('dentro de la ventana de N días → alerta', () => {
    expect(chequeProximoACobrar({ fecha_cobro: '2026-06-10', estado: 'entregado' }, 7, '2026-06-08')).toBe(true)
  })
  it('fuera de la ventana → no alerta', () => {
    expect(chequeProximoACobrar({ fecha_cobro: '2026-06-30', estado: 'entregado' }, 7, '2026-06-08')).toBe(false)
  })
  it('vencido (fecha pasada) y pendiente → alerta', () => {
    expect(chequeProximoACobrar({ fecha_cobro: '2026-06-01', estado: 'entregado' }, 7, '2026-06-08')).toBe(true)
  })
  it('cheque cobrado no alerta', () => {
    expect(chequeProximoACobrar({ fecha_cobro: '2026-06-10', estado: 'cobrado' }, 7, '2026-06-08')).toBe(false)
  })
  it('sin fecha_cobro no alerta', () => {
    expect(chequeProximoACobrar({ fecha_cobro: null, estado: 'entregado' }, 7, '2026-06-08')).toBe(false)
  })
})

describe('chequeVencido', () => {
  it('fecha pasada + pendiente → vencido', () => {
    expect(chequeVencido({ fecha_cobro: '2026-06-01', estado: 'entregado' }, '2026-06-08')).toBe(true)
  })
  it('fecha futura → no vencido', () => {
    expect(chequeVencido({ fecha_cobro: '2026-06-30', estado: 'entregado' }, '2026-06-08')).toBe(false)
  })
  it('terminal no vence', () => {
    expect(chequeVencido({ fecha_cobro: '2026-06-01', estado: 'cobrado' }, '2026-06-08')).toBe(false)
  })
})

describe('validarChequeAlta', () => {
  it('ok con monto y fecha', () => {
    expect(validarChequeAlta({ monto: 1000, fecha_cobro: '2026-06-30', tipo: 'propio' })).toBeNull()
  })
  it('monto <= 0 falla', () => {
    expect(validarChequeAlta({ monto: 0, fecha_cobro: '2026-06-30', tipo: 'propio' })).toMatch(/monto/i)
  })
  it('sin fecha_cobro falla', () => {
    expect(validarChequeAlta({ monto: 1000, fecha_cobro: null, tipo: 'propio' })).toMatch(/fecha/i)
  })
})

describe('totalPendiente', () => {
  it('suma solo los no terminales', () => {
    expect(totalPendiente([
      { estado: 'entregado', monto: 1000 },
      { estado: 'en_cartera', monto: 500 },
      { estado: 'cobrado', monto: 9999 },
      { estado: 'anulado', monto: 100 },
    ])).toBe(1500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Auditoría #5 (v1.54.0) — cheques conectados al circuito de pago
// ─────────────────────────────────────────────────────────────────────────────
import { montoChequeDeMedios, reversionPagoOC, reversionPagoGasto } from '@/lib/comprasCheques'

describe('montoChequeDeMedios', () => {
  it('suma solo los medios de tipo Cheque', () => {
    expect(montoChequeDeMedios([
      { tipo: 'Efectivo', monto: 1000 },
      { tipo: 'Cheque', monto: 5000 },
      { tipo: 'Cheque', monto: 2500 },
    ])).toBe(7500)
  })
  it('sin cheques devuelve 0', () => {
    expect(montoChequeDeMedios([{ tipo: 'Transferencia', monto: 1000 }])).toBe(0)
    expect(montoChequeDeMedios([])).toBe(0)
  })
  it('ignora montos inválidos o negativos', () => {
    expect(montoChequeDeMedios([
      { tipo: 'Cheque', monto: NaN },
      { tipo: 'Cheque', monto: -100 },
      { tipo: 'Cheque', monto: 300 },
    ])).toBe(300)
  })
  it('redondea a 2 decimales', () => {
    expect(montoChequeDeMedios([{ tipo: 'Cheque', monto: 0.1 }, { tipo: 'Cheque', monto: 0.2 }])).toBe(0.3)
  })
})

describe('reversionPagoOC (cheque rechazado)', () => {
  it('pago total con cheque → vuelve a pendiente_pago', () => {
    expect(reversionPagoOC({ total: 10000, montoPagado: 10000, montoCheque: 10000 }))
      .toEqual({ montoPagado: 0, estadoPago: 'pendiente_pago' })
  })
  it('pago mixto (cheque + efectivo) → queda pago_parcial', () => {
    expect(reversionPagoOC({ total: 10000, montoPagado: 10000, montoCheque: 6000 }))
      .toEqual({ montoPagado: 4000, estadoPago: 'pago_parcial' })
  })
  it('con descuento que sigue cubriendo el total → sigue pagada', () => {
    // total 10000, descuento 9500, pagado 500 con cheque de 0... caso: cheque chico, desc grande
    expect(reversionPagoOC({ total: 10000, montoPagado: 500, montoDescuento: 9500, montoCheque: 0 }))
      .toEqual({ montoPagado: 500, estadoPago: 'pagada' })
  })
  it('nunca deja monto_pagado negativo', () => {
    expect(reversionPagoOC({ total: 10000, montoPagado: 3000, montoCheque: 5000 }).montoPagado).toBe(0)
  })
})

describe('reversionPagoGasto (cheque rechazado)', () => {
  it('pago total con cheque → vuelve a pendiente', () => {
    expect(reversionPagoGasto({ montoPagado: 8000, montoCheque: 8000 }))
      .toEqual({ montoPagado: 0, estadoPago: 'pendiente' })
  })
  it('pago parcial con cheque → queda parcial', () => {
    expect(reversionPagoGasto({ montoPagado: 8000, montoCheque: 3000 }))
      .toEqual({ montoPagado: 5000, estadoPago: 'parcial' })
  })
  it('nunca negativo', () => {
    expect(reversionPagoGasto({ montoPagado: 1000, montoCheque: 5000 }).montoPagado).toBe(0)
  })
})
