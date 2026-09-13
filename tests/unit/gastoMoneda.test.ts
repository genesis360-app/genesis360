import { describe, it, expect } from 'vitest'
import {
  monedasParaGasto, cajasOperativasDeMoneda, cajaFuerteDeMoneda,
  puedePagarEfectivoEn, medioSirveParaMoneda, validarPagoGasto, totalesPorMoneda,
  type SesionCaja,
} from '@/lib/gastoMoneda'

// Plan: pedido de GO (2026-09-11) — el gasto puede ser en cualquier moneda, con la del negocio
// por defecto. 🛑 REGLA #0: un gasto mueve plata de una caja, y el trigger
// `fn_validar_moneda_coincide_sesion` RECHAZA un movimiento cuya moneda no coincida con la sesión.

const sesiones: SesionCaja[] = [
  { id: 'ars-1', cajas: { nombre: 'Caja 1',     es_caja_fuerte: false, moneda: 'ARS' } },
  { id: 'usd-1', cajas: { nombre: 'Caja USD',   es_caja_fuerte: false, moneda: 'USD' } },
  { id: 'f-ars', cajas: { nombre: 'Fuerte ARS', es_caja_fuerte: true,  moneda: 'ARS' } },
  { id: 'f-usd', cajas: { nombre: 'Fuerte USD', es_caja_fuerte: true,  moneda: 'USD' } },
]

// ─────────────────────────────────────────────────────────────────────────────
// monedasParaGasto (GM-LISTA)
// ─────────────────────────────────────────────────────────────────────────────
describe('monedasParaGasto', () => {
  it('GM-LISTA-01 la moneda del NEGOCIO va primera (es el default del selector)', () => {
    expect(monedasParaGasto('ARS')[0]).toBe('ARS')
    expect(monedasParaGasto('CLP')[0]).toBe('CLP')   // hay un tenant real en CLP
  })
  it('GM-LISTA-02 no repite la principal más abajo en la lista', () => {
    const lista = monedasParaGasto('USD')
    expect(lista[0]).toBe('USD')
    expect(lista.filter(m => m === 'USD')).toHaveLength(1)
  })
  it('GM-LISTA-03 sin moneda configurada cae en ARS, no en vacío', () => {
    expect(monedasParaGasto(null)[0]).toBe('ARS')
    expect(monedasParaGasto(undefined)[0]).toBe('ARS')
  })
  it('GM-LISTA-04 ofrece más que ARS/USD: el proveedor puede cobrar en otra', () => {
    expect(monedasParaGasto('ARS')).toContain('EUR')
    expect(monedasParaGasto('ARS')).toContain('BRL')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cajas por moneda (GM-CAJA)
// ─────────────────────────────────────────────────────────────────────────────
describe('cajas por moneda', () => {
  it('GM-CAJA-01 solo las operativas de esa moneda (la fuerte va aparte)', () => {
    expect(cajasOperativasDeMoneda(sesiones, 'ARS').map(s => s.id)).toEqual(['ars-1'])
    expect(cajasOperativasDeMoneda(sesiones, 'USD').map(s => s.id)).toEqual(['usd-1'])
  })
  it('GM-CAJA-02 la caja fuerte se resuelve POR MONEDA (desde la mig 373 hay una por cada una)', () => {
    expect(cajaFuerteDeMoneda(sesiones, 'ARS')?.id).toBe('f-ars')
    expect(cajaFuerteDeMoneda(sesiones, 'USD')?.id).toBe('f-usd')
  })
  it('GM-CAJA-03 una moneda sin caja no devuelve la de otra moneda "porque es la que hay"', () => {
    expect(cajasOperativasDeMoneda(sesiones, 'EUR')).toEqual([])
    expect(cajaFuerteDeMoneda(sesiones, 'EUR')).toBeNull()
    expect(puedePagarEfectivoEn(sesiones, 'EUR')).toBe(false)
  })
  it('GM-CAJA-04 con solo la caja fuerte abierta, igual se puede pagar', () => {
    const soloFuerte = sesiones.filter(s => s.cajas?.es_caja_fuerte)
    expect(puedePagarEfectivoEn(soloFuerte, 'USD')).toBe(true)
  })
  it('GM-CAJA-05 moneda ausente en la caja cuenta como ARS (default del schema)', () => {
    const sinMoneda: SesionCaja[] = [{ id: 'x', cajas: { es_caja_fuerte: false, moneda: null } }]
    expect(cajasOperativasDeMoneda(sinMoneda, 'ARS').map(s => s.id)).toEqual(['x'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// medioSirveParaMoneda (GM-MEDIO)
// ─────────────────────────────────────────────────────────────────────────────
describe('medioSirveParaMoneda', () => {
  it('GM-MEDIO-01 🛑 efectivo: tiene que ser de la MISMA moneda que el gasto', () => {
    expect(medioSirveParaMoneda('USD', 'USD', true)).toBe(true)
    expect(medioSirveParaMoneda('ARS', 'USD', true)).toBe(false)
  })
  it('GM-MEDIO-02 los medios NO efectivo no se bloquean: no tocan el saldo de ninguna caja', () => {
    // Un gasto en dólares se puede pagar por transferencia sin que exista una caja USD.
    expect(medioSirveParaMoneda('ARS', 'USD', false)).toBe(true)
  })
  it('GM-MEDIO-03 medio sin moneda cuenta como ARS', () => {
    expect(medioSirveParaMoneda(null, 'ARS', true)).toBe(true)
    expect(medioSirveParaMoneda(null, 'USD', true)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validarPagoGasto (GM-VAL) — el aviso ANTES de escribir
// ─────────────────────────────────────────────────────────────────────────────
describe('validarPagoGasto', () => {
  it('GM-VAL-01 gasto en USD pagado con Efectivo USD y caja USD abierta → OK', () => {
    expect(validarPagoGasto({
      monedaGasto: 'USD', sesiones,
      medios: [{ tipo: 'Efectivo USD', monto: 100, moneda: 'USD', esEfectivo: true }],
    })).toBeNull()
  })

  it('GM-VAL-02 🛑 gasto en USD con efectivo en PESOS → se frena con el motivo', () => {
    const r = validarPagoGasto({
      monedaGasto: 'USD', sesiones,
      medios: [{ tipo: 'Efectivo', monto: 100, moneda: 'ARS', esEfectivo: true }],
    })
    expect(r?.motivo).toBe('medio_otra_moneda')
    expect(r?.detalle).toMatch(/misma moneda/i)
  })

  it('GM-VAL-03 🛑 gasto en EUR en efectivo sin caja EUR → se avisa ANTES, no falla el trigger', () => {
    const r = validarPagoGasto({
      monedaGasto: 'EUR', sesiones,
      medios: [{ tipo: 'Efectivo', monto: 50, moneda: 'EUR', esEfectivo: true }],
    })
    expect(r?.motivo).toBe('sin_caja')
    expect(r?.detalle).toMatch(/EUR/)
  })

  it('GM-VAL-04 gasto en EUR por TRANSFERENCIA → pasa aunque no haya caja EUR', () => {
    expect(validarPagoGasto({
      monedaGasto: 'EUR', sesiones,
      medios: [{ tipo: 'Transferencia', monto: 50, moneda: 'ARS', esEfectivo: false }],
    })).toBeNull()
  })

  it('GM-VAL-05 sin medios cargados (gasto que queda pendiente de pago) → no valida nada', () => {
    expect(validarPagoGasto({ monedaGasto: 'USD', sesiones, medios: [] })).toBeNull()
    expect(validarPagoGasto({
      monedaGasto: 'USD', sesiones,
      medios: [{ tipo: 'Efectivo USD', monto: 0, moneda: 'USD', esEfectivo: true }],
    })).toBeNull()
  })

  it('GM-VAL-06 el gasto en pesos de siempre sigue funcionando igual', () => {
    expect(validarPagoGasto({
      monedaGasto: 'ARS', sesiones,
      medios: [{ tipo: 'Efectivo', monto: 5000, moneda: 'ARS', esEfectivo: true }],
    })).toBeNull()
  })

  it('GM-VAL-07 pago mixto: alcanza con que UN efectivo esté cruzado para frenar', () => {
    const r = validarPagoGasto({
      monedaGasto: 'USD', sesiones,
      medios: [
        { tipo: 'Efectivo USD', monto: 50, moneda: 'USD', esEfectivo: true },
        { tipo: 'Efectivo',     monto: 50, moneda: 'ARS', esEfectivo: true },
      ],
    })
    expect(r?.motivo).toBe('medio_otra_moneda')
  })
})

// ── totalesPorMoneda ────────────────────────────────────────────────────────────────────────
// 🛑 El tab de "Gastos fijos" mostraba UN total mensual estimado sumando todas las filas sin mirar
// la moneda: un alquiler de US$500 + uno de $300.000 daba "$300.500", un número que no existe.
// Con un solo tipo de moneda daba bien, que es por lo que pasó desapercibido.
describe('totalesPorMoneda — no sumar peras con manzanas', () => {
  it('agrupa por moneda en vez de sumar todo junto', () => {
    const r = totalesPorMoneda(
      [
        { monto: 300000, moneda: 'ARS' },
        { monto: 500, moneda: 'USD' },
        { monto: 120000, moneda: 'ARS' },
      ],
      'ARS',
    )
    expect(r).toEqual([['ARS', 420000], ['USD', 500]])
  })

  it('la moneda del negocio va primero, el resto alfabético', () => {
    const r = totalesPorMoneda(
      [{ monto: 1, moneda: 'USD' }, { monto: 2, moneda: 'ARS' }, { monto: 3, moneda: 'BRL' }],
      'USD',
    )
    expect(r.map(([m]) => m)).toEqual(['USD', 'ARS', 'BRL'])
  })

  it('una fila sin moneda cuenta como la del negocio (default de la columna)', () => {
    expect(totalesPorMoneda([{ monto: 10 }, { monto: 5, moneda: null }], 'CLP'))
      .toEqual([['CLP', 15]])
  })

  it('los montos que vienen como string (numeric de Postgres) se suman igual', () => {
    expect(totalesPorMoneda([{ monto: '10.50' }, { monto: '0.50' }], 'ARS'))
      .toEqual([['ARS', 11]])
  })

  it('sin filas no inventa un total', () => {
    expect(totalesPorMoneda([], 'ARS')).toEqual([])
    expect(totalesPorMoneda(null, 'ARS')).toEqual([])
  })
})
