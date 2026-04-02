import { describe, it, expect } from 'vitest'
import { calcularVuelto, calcularEfectivoCaja, calcularComboRows, restaurarMediosPago } from '@/lib/ventasValidation'

// ─── calcularVuelto ────────────────────────────────────────────────────────────

describe('calcularVuelto', () => {
  it('sin vuelto cuando efectivo = total', () => {
    expect(calcularVuelto([{ tipo: 'Efectivo', monto: '1000' }], 1000)).toBe(0)
  })
  it('calcula vuelto cuando efectivo > total', () => {
    expect(calcularVuelto([{ tipo: 'Efectivo', monto: '2000' }], 1500)).toBe(500)
  })
  it('sin vuelto cuando efectivo < total', () => {
    expect(calcularVuelto([{ tipo: 'Efectivo', monto: '500' }], 1000)).toBe(0)
  })
  it('sin vuelto si el exceso es tarjeta (no efectivo)', () => {
    expect(calcularVuelto([{ tipo: 'Tarjeta débito', monto: '2000' }], 1500)).toBe(0)
  })
  it('calcula vuelto con múltiples medios — solo exceso total', () => {
    // efectivo 800 + tarjeta 500 = 1300 sobre total 1000 → vuelto 300
    const medios = [{ tipo: 'Efectivo', monto: '800' }, { tipo: 'Tarjeta débito', monto: '500' }]
    expect(calcularVuelto(medios, 1000)).toBe(300)
  })
  it('tolerancia: diferencia menor a $0.50 no genera vuelto', () => {
    expect(calcularVuelto([{ tipo: 'Efectivo', monto: '1000.3' }], 1000)).toBe(0)
  })
  it('sin medios de pago retorna 0', () => {
    expect(calcularVuelto([], 1000)).toBe(0)
  })
})

// ─── calcularEfectivoCaja ──────────────────────────────────────────────────────

describe('calcularEfectivoCaja', () => {
  it('efectivo exacto va completo a caja', () => {
    expect(calcularEfectivoCaja([{ tipo: 'Efectivo', monto: '1000' }], 1000)).toBe(1000)
  })
  it('descuenta el vuelto del efectivo', () => {
    // cliente paga $2000, venta $1500 → caja recibe $1500
    expect(calcularEfectivoCaja([{ tipo: 'Efectivo', monto: '2000' }], 1500)).toBe(1500)
  })
  it('tarjeta no afecta el efectivo de caja', () => {
    expect(calcularEfectivoCaja([{ tipo: 'Tarjeta débito', monto: '1000' }], 1000)).toBe(0)
  })
  it('efectivo parcial + tarjeta: solo efectivo va a caja', () => {
    const medios = [{ tipo: 'Efectivo', monto: '500' }, { tipo: 'Tarjeta débito', monto: '500' }]
    expect(calcularEfectivoCaja(medios, 1000)).toBe(500)
  })
  it('efectivo reserva + saldo efectivo: caja recibe suma completa (caso despacho reserva)', () => {
    // reserva cobró $500 efectivo, saldo cobra $1000 efectivo → total $1500 a caja
    const medios = [{ tipo: 'Efectivo', monto: '1500' }]
    expect(calcularEfectivoCaja(medios, 1500)).toBe(1500)
  })
  it('vuelto en efectivo con múltiples medios', () => {
    // efectivo 800 + tarjeta 500 = 1300 sobre total 1000 → caja recibe 500 efectivo (800 - 300 vuelto)
    const medios = [{ tipo: 'Efectivo', monto: '800' }, { tipo: 'Tarjeta débito', monto: '500' }]
    expect(calcularEfectivoCaja(medios, 1000)).toBe(500)
  })
})

// ─── calcularComboRows ─────────────────────────────────────────────────────────

describe('calcularComboRows', () => {
  const combo = { cantidad: 3, descuento_pct: 10, descuento_tipo: 'pct', descuento_monto: 0 }

  it('cantidad exacta al combo → una fila con descuento', () => {
    const rows = calcularComboRows(3, combo)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ cantidad: 3, descuento: 10, descuento_tipo: 'pct' })
  })
  it('cantidad mayor al combo → fila con descuento + fila sin descuento', () => {
    const rows = calcularComboRows(5, combo)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ cantidad: 3, descuento: 10, descuento_tipo: 'pct' })
    expect(rows[1]).toEqual({ cantidad: 2, descuento: 0, descuento_tipo: 'pct' })
  })
  it('múltiplo exacto del combo → solo filas con descuento', () => {
    const rows = calcularComboRows(6, combo)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ cantidad: 6, descuento: 10, descuento_tipo: 'pct' })
  })
  it('combo monto_ars → descuento tipo monto', () => {
    const comboArs = { cantidad: 2, descuento_pct: 0, descuento_tipo: 'monto_ars', descuento_monto: 200 }
    const rows = calcularComboRows(4, comboArs)
    expect(rows[0]).toEqual({ cantidad: 4, descuento: 200, descuento_tipo: 'monto' })
  })
  it('combo monto_usd → convierte con cotización', () => {
    const comboUsd = { cantidad: 2, descuento_pct: 0, descuento_tipo: 'monto_usd', descuento_monto: 1 }
    const rows = calcularComboRows(2, comboUsd, 1000)
    expect(rows[0]).toEqual({ cantidad: 2, descuento: 1000, descuento_tipo: 'monto' })
  })
})

// ─── restaurarMediosPago ───────────────────────────────────────────────────────

describe('restaurarMediosPago', () => {
  it('parsea JSON válido y retorna MedioPagoItem[]', () => {
    const json = JSON.stringify([{ tipo: 'Efectivo', monto: 500 }, { tipo: 'Tarjeta', monto: 500 }])
    const result = restaurarMediosPago(json)
    expect(result).toEqual([{ tipo: 'Efectivo', monto: '500' }, { tipo: 'Tarjeta', monto: '500' }])
  })
  it('filtra medios con monto 0', () => {
    const json = JSON.stringify([{ tipo: 'Efectivo', monto: 500 }, { tipo: 'Tarjeta', monto: 0 }])
    const result = restaurarMediosPago(json)
    expect(result).toHaveLength(1)
    expect(result[0].tipo).toBe('Efectivo')
  })
  it('retorna [] para JSON inválido', () => {
    expect(restaurarMediosPago('no-es-json')).toEqual([])
  })
  it('retorna [] para null/undefined', () => {
    expect(restaurarMediosPago(null)).toEqual([])
    expect(restaurarMediosPago(undefined)).toEqual([])
  })
  it('retorna [] para string vacío', () => {
    expect(restaurarMediosPago('')).toEqual([])
  })
  it('retorna [] para JSON no-array', () => {
    expect(restaurarMediosPago(JSON.stringify({ tipo: 'Efectivo', monto: 500 }))).toEqual([])
  })
})
