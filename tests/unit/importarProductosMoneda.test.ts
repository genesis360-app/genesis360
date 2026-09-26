import { describe, it, expect } from 'vitest'
import { monedaProductoImportada, margenGenerado, margenEntraEnLaBase, margenSospechosoPorMonedas, montoYMonedaParaExportar } from '@/lib/importarProductosMoneda'

// A0 — el importador de productos y las columnas de moneda.
// Contexto en `src/lib/importarProductosMoneda.ts` y en
// `G360.Wiki/sources/raw/relevamiento_multimoneda_respuestas.md` (sección A0).
const COTIZ = 1400 // tasa de COMPRA, la misma con la que el POS valúa un producto en dólares

describe('monedaProductoImportada', () => {
  describe('CSV en pesos', () => {
    it('deja el importe tal cual y marca la moneda viva como local', () => {
      expect(monedaProductoImportada(2500, 'ARS', COTIZ)).toEqual({
        precioArs: 2500, precioUsd: null, moneda: 'local',
      })
    })

    it('no necesita cotización: un producto en pesos se importa aunque no haya ninguna cargada', () => {
      expect(monedaProductoImportada(2500, 'ARS', 0)).toEqual({
        precioArs: 2500, precioUsd: null, moneda: 'local',
      })
    })

    it('trata la moneda vacía como pesos, que es el default de la plantilla', () => {
      expect(monedaProductoImportada(999, '', COTIZ)?.moneda).toBe('local')
    })
  })

  describe('CSV en dólares — el bug que cierra A0', () => {
    it('guarda el monto en precioUsd y el espejo convertido en precioArs', () => {
      // 🛑 Antes esto devolvía 100 en pesos: el producto se vendía a $100 en vez de USD 100.
      expect(monedaProductoImportada(100, 'USD', COTIZ)).toEqual({
        precioArs: 140000, precioUsd: 100, moneda: 'usd',
      })
    })

    it('el espejo en pesos NO es el número crudo del CSV', () => {
      const r = monedaProductoImportada(100, 'USD', COTIZ)!
      expect(r.precioArs).not.toBe(100)
      expect(r.precioArs).toBe(100 * COTIZ)
    })

    it('acepta la moneda en minúscula y con espacios', () => {
      expect(monedaProductoImportada(4.5, '  usd  ', COTIZ)?.moneda).toBe('usd')
    })

    it('redondea el espejo a 2 decimales', () => {
      // 4.5 × 1399.99 = 6299.955 → 6299.96, no 6299.9549999999999
      const r = monedaProductoImportada(4.5, 'USD', 1399.99)!
      expect(r.precioArs).toBe(6299.96)
      expect(r.precioUsd).toBe(4.5) // el monto en dólares queda intacto, sin redondear
    })
  })

  describe('sin cotización — nunca se inventa una tasa (D5)', () => {
    it.each([0, -1, NaN, Infinity])('devuelve null con cotización %p', (cotiz) => {
      expect(monedaProductoImportada(100, 'USD', cotiz as number)).toBeNull()
    })

    it('null significa "rechazá la fila", no "importá 0"', () => {
      // El peor final posible sería devolver { precioArs: 0 } y dejar el producto gratis, o
      // devolver { precioArs: 100 } y volver al bug original. Tiene que ser null.
      expect(monedaProductoImportada(100, 'USD', 0)).toBeNull()
    })
  })

  describe('reimportar un producto que estaba en dólares', () => {
    it('un CSV en ARS lo devuelve a pesos y limpia el monto en dólares', () => {
      // 🛑 Antes `moneda_venta` quedaba en 'usd' y el POS seguía cobrando `precio_usd × cotización`,
      // ignorando por completo el precio que traía la importación.
      const r = monedaProductoImportada(3000, 'ARS', COTIZ)!
      expect(r.moneda).toBe('local')
      expect(r.precioUsd).toBeNull()
      expect(r.precioArs).toBe(3000)
    })
  })

  describe('importe cero', () => {
    it('no explota ni inventa moneda', () => {
      expect(monedaProductoImportada(0, 'USD', COTIZ)).toEqual({
        precioArs: 0, precioUsd: 0, moneda: 'usd',
      })
    })
  })
})

// ── Tope del margen que la base puede guardar ────────────────────────────────
// `productos.margen_ganancia` es GENERATED numeric(8,2) (mig 436; antes numeric(5,2), techo
// 999,99 %): más de 999.999,99 % no entra y Postgres responde "numeric field overflow".
describe('margenGenerado / margenEntraEnLaBase', () => {
  it('calcula el mismo margen que la columna generada', () => {
    // ((250 - 150) / 150) * 100 = 66.67
    expect(margenGenerado(150, 250)).toBe(66.67)
  })

  it('un margen normal entra sin problema', () => {
    expect(margenEntraEnLaBase(150, 250)).toBe(true)
  })

  it('costo 0 no desborda: la base guarda 0', () => {
    expect(margenGenerado(0, 999999)).toBeNull()
    expect(margenEntraEnLaBase(0, 999999)).toBe(true)
  })

  it('🛑 D-2: un café de $30 vendido a $1.500 (4.900 %) SE PUEDE GUARDAR', () => {
    // Con numeric(5,2) este producto no se podía guardar: la app rechazaba un precio legítimo.
    expect(margenGenerado(30, 1500)).toBe(4900)
    expect(margenEntraEnLaBase(30, 1500)).toBe(true)
  })

  it('el viejo tope (999,99 %) ya no frena', () => {
    expect(margenEntraEnLaBase(100, 1101)).toBe(true)
  })

  it('justo en el tope nuevo entra', () => {
    // costo 1 → 999.999,99 % es un precio de 10.000,9999
    expect(margenEntraEnLaBase(1, 10000.9999)).toBe(true)
  })

  it('por encima del tope nuevo NO entra', () => {
    expect(margenEntraEnLaBase(1, 10001)).toBe(false)
  })

  it('una pérdida enorme también desborda, por el lado negativo', () => {
    // El guard es simétrico a propósito, por si algún día el costo llega negativo.
    expect(margenEntraEnLaBase(1, -99999999)).toBe(false)
  })
})

// ── Red de seguridad del importador: costo y precio en monedas distintas ─────
// Antes de la mig 436 el techo de la columna frenaba de rebote el CSV que mezcla monedas. Al
// ampliarla, se conserva el mismo umbral (999,99 %) SOLO para las filas con monedas mezcladas.
describe('margenSospechosoPorMonedas', () => {
  it('🛑 el caso real: CSV con costo en ARS y precio en USD sigue frenado', () => {
    // costo 150 ARS contra precio 100 USD (= 140.000 ARS a 1400) → 93.233 %
    const costo = monedaProductoImportada(150, 'ARS', 1400)!
    const venta = monedaProductoImportada(100, 'USD', 1400)!
    expect(margenEntraEnLaBase(costo.precioArs, venta.precioArs)).toBe(true) // la base lo aceptaría…
    expect(margenSospechosoPorMonedas(costo.precioArs, venta.precioArs)).toBe(true) // …el importador no
  })

  it('el mismo par en la misma moneda no es sospechoso', () => {
    const costo = monedaProductoImportada(60, 'USD', 1400)!
    const venta = monedaProductoImportada(100, 'USD', 1400)!
    expect(margenSospechosoPorMonedas(costo.precioArs, venta.precioArs)).toBe(false)
    expect(margenGenerado(costo.precioArs, venta.precioArs)).toBe(66.67)
  })

  it('costo en USD y precio en ARS con un margen razonable pasa', () => {
    // costo 10 USD (14.000 ARS) vendido a 21.000 ARS → 50 %
    expect(margenSospechosoPorMonedas(14000, 21000)).toBe(false)
  })

  it('en el umbral exacto no es sospechoso; un punto arriba sí', () => {
    expect(margenSospechosoPorMonedas(100, 1099.99)).toBe(false)
    expect(margenSospechosoPorMonedas(100, 1101)).toBe(true)
  })

  it('costo 0: no se puede calcular, no es sospechoso', () => {
    expect(margenSospechosoPorMonedas(0, 5000)).toBe(false)
  })
})

// ── Ida y vuelta: exportar productos → volver a importar ─────────────────────
describe('montoYMonedaParaExportar', () => {
  it('un producto en pesos sale con su precio y ARS', () => {
    expect(montoYMonedaParaExportar(2500, null, 'local')).toEqual({ monto: 2500, moneda: 'ARS' })
  })

  it('🛑 un producto en dólares sale con el monto en DÓLARES, no con el espejo en pesos', () => {
    // Exportar 140000 con moneda USD lo volvería a multiplicar por la cotización al reimportar.
    expect(montoYMonedaParaExportar(140000, 100, 'usd')).toEqual({ monto: 100, moneda: 'USD' })
  })

  it('tolera nulos sin romper', () => {
    expect(montoYMonedaParaExportar(null, null, 'local')).toEqual({ monto: 0, moneda: 'ARS' })
    expect(montoYMonedaParaExportar(null, null, 'usd')).toEqual({ monto: 0, moneda: 'USD' })
  })

  it('EL IDA Y VUELTA NO DEFORMA NADA: exportar → importar devuelve lo mismo', () => {
    for (const original of [
      { ars: 2500,   usd: null, moneda: 'local' },
      { ars: 140000, usd: 100,  moneda: 'usd'   },
      { ars: 84000,  usd: 60,   moneda: 'usd'   },
    ]) {
      const exportado = montoYMonedaParaExportar(original.ars, original.usd, original.moneda)
      const reimportado = monedaProductoImportada(exportado.monto, exportado.moneda, COTIZ)!
      expect(reimportado.moneda).toBe(original.moneda)
      expect(reimportado.precioUsd).toBe(original.usd)
      expect(reimportado.precioArs).toBe(original.ars)
    }
  })
})
