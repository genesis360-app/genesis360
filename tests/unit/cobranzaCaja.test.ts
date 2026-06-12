import { describe, it, expect } from 'vitest'
import { movimientoCajaCobranza } from '@/lib/cobranzaCC'

/**
 * Auditoría 2026-06-11 — impacto en arqueo de la cobranza CC.
 * `movimientoCajaCobranza` decide qué movimiento de caja genera una cobranza:
 *  - Efectivo → `ingreso` real (suma al arqueo)
 *  - otro método → `ingreso_informativo` (no afecta saldo, igual que en ventas)
 *  - método vacío → null (sin movimiento)
 */
describe('movimientoCajaCobranza', () => {
  it('Efectivo genera ingreso real con nombre del cliente', () => {
    expect(movimientoCajaCobranza('Efectivo', 'Juan Pérez')).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC — Juan Pérez',
    })
  })

  it('Efectivo es case-insensitive', () => {
    expect(movimientoCajaCobranza('efectivo', 'Ana')).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC — Ana',
    })
  })

  it('sin nombre de cliente, el concepto no lleva sufijo', () => {
    expect(movimientoCajaCobranza('Efectivo')).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC',
    })
    expect(movimientoCajaCobranza('Efectivo', null)).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC',
    })
    expect(movimientoCajaCobranza('Efectivo', '   ')).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC',
    })
  })

  it('Tarjeta genera ingreso_informativo con prefijo [Método] (patrón ventas)', () => {
    expect(movimientoCajaCobranza('Tarjeta', 'Juan')).toEqual({
      tipo: 'ingreso_informativo',
      concepto: '[Tarjeta] Cobranza CC — Juan',
    })
  })

  it('Transferencia y Mercado Pago también son informativos', () => {
    expect(movimientoCajaCobranza('Transferencia')).toEqual({
      tipo: 'ingreso_informativo',
      concepto: '[Transferencia] Cobranza CC',
    })
    expect(movimientoCajaCobranza('Mercado Pago', 'Ana')).toEqual({
      tipo: 'ingreso_informativo',
      concepto: '[Mercado Pago] Cobranza CC — Ana',
    })
  })

  it('método vacío o solo espacios → null (sin movimiento)', () => {
    expect(movimientoCajaCobranza('')).toBeNull()
    expect(movimientoCajaCobranza('   ')).toBeNull()
  })

  it('recorta espacios del método y del nombre', () => {
    expect(movimientoCajaCobranza('  Efectivo  ', '  Juan  ')).toEqual({
      tipo: 'ingreso',
      concepto: 'Cobranza CC — Juan',
    })
  })
})
