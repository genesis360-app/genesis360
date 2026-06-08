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
