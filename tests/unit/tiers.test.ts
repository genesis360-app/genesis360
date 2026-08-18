import { describe, it, expect } from 'vitest'
import {
  matchTier, precioTier, mejorPrecioMayorista, precioUnitarioDeTier, resolverBloquesTier,
  precioBlendedTier, type TierMayorista,
} from '@/lib/tiers'

// Rediseño UoM Fase 2-bis (mig 306) — tiers de precio mayorista con operador + orden.
// "Gana el PRIMER tier que matchea en `orden` asc; si ninguno, el llamador usa el precio base."

describe('matchTier', () => {
  it('cubre los 5 operadores', () => {
    expect(matchTier(60, 50, '>=')).toBe(true)
    expect(matchTier(50, 50, '>=')).toBe(true)
    expect(matchTier(49, 50, '>=')).toBe(false)
    expect(matchTier(51, 50, '>')).toBe(true)
    expect(matchTier(50, 50, '>')).toBe(false)
    expect(matchTier(50, 50, '=')).toBe(true)
    expect(matchTier(51, 50, '=')).toBe(false)
    expect(matchTier(49, 50, '<=')).toBe(true)
    expect(matchTier(50, 50, '<=')).toBe(true)
    expect(matchTier(49, 50, '<')).toBe(true)
    expect(matchTier(50, 50, '<')).toBe(false)
  })
})

describe('precioTier', () => {
  // 🛑 Regresión del bug de plata que encontró el migration-reviewer (mig 306): con dos tiers >=
  // por volumen, el de MAYOR umbral satisfecho tiene que ganar. Por eso el backfill los ordena
  // DESC (mayor cantidad = orden 0), y first-match reproduce el "descuento por volumen".
  const volumen: TierMayorista[] = [
    { cantidad_minima: 50, precio: 80, operador: '>=', orden: 0 }, // mayor umbral primero
    { cantidad_minima: 10, precio: 90, operador: '>=', orden: 1 },
  ]

  it('descuento por volumen: comprar 60 paga el tier de 50+ ($80), no el de 10+ ($90)', () => {
    expect(precioTier(volumen, 60)).toBe(80)
  })
  it('comprar 30 cae al tier de 10+ ($90)', () => {
    expect(precioTier(volumen, 30)).toBe(90)
  })
  it('comprar 5 no matchea ningún tier → null (el POS usa el precio base)', () => {
    expect(precioTier(volumen, 5)).toBeNull()
  })

  it('operador "=" (pallet exacto): solo matchea la cantidad justa', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 800, precio: 40000, operador: '=', orden: 0 },
      { cantidad_minima: 1, precio: 70, operador: '>=', orden: 1 },
    ]
    expect(precioTier(tiers, 800)).toBe(40000)  // pallet exacto
    expect(precioTier(tiers, 801)).toBe(70)     // 801 ya no es "pallet exacto" → cae al >=1
    expect(precioTier(tiers, 799)).toBe(70)
  })

  it('gana el PRIMER match en orden, aunque otro también matchee', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 100, precio: 60, operador: '>=', orden: 0 },
      { cantidad_minima: 100, precio: 50, operador: '>=', orden: 1 }, // también matchea 100 pero pierde
    ]
    expect(precioTier(tiers, 150)).toBe(60)
  })

  it('sin tiers → null', () => {
    expect(precioTier([], 100)).toBeNull()
  })

  it('ignora tiers con precio negativo', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 10, precio: -5, operador: '>=', orden: 0 },
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 1 },
    ]
    expect(precioTier(tiers, 20)).toBe(90)
  })
})

// Fede 25/7, punto 1: tier de tipo % + enlace opcional a una línea de empaque (el "caso del pallet").
describe('precioUnitarioDeTier', () => {
  it('precio_fijo (legacy/default): devuelve el precio tal cual', () => {
    expect(precioUnitarioDeTier({ tipo_valor: 'precio_fijo', precio: 80 }, 100)).toBe(80)
    expect(precioUnitarioDeTier({ precio: 80 }, 100)).toBe(80) // sin tipo_valor = legacy
  })

  it('pct: descuenta sobre el precio de LISTA, nunca sobre uno ya rebajado', () => {
    expect(precioUnitarioDeTier({ tipo_valor: 'pct', precio: 10 }, 100)).toBe(90)
    expect(precioUnitarioDeTier({ tipo_valor: 'pct', precio: 25 }, 200)).toBe(150)
  })

  it('pct fuera de rango se clampea a 0-100 (defensivo)', () => {
    expect(precioUnitarioDeTier({ tipo_valor: 'pct', precio: 150 }, 100)).toBe(0)
    expect(precioUnitarioDeTier({ tipo_valor: 'pct', precio: -10 }, 100)).toBe(100)
  })

  // Bug real (Fede, 2026-08-18, mig 367): faltaba la opción USD en los tiers — un tier
  // `precio_fijo` siempre se cobraba en pesos, sin mirar la moneda del producto.
  it('usd: convierte el monto en dólares a la cotización vigente', () => {
    expect(precioUnitarioDeTier({ tipo_valor: 'usd', precio: 10 }, 999999, 1200)).toBe(12000)
  })

  it('usd: sin cotización cargada, no se puede convertir con seguridad → no aplica el tier (precio de lista)', () => {
    expect(precioUnitarioDeTier({ tipo_valor: 'usd', precio: 10 }, 5000)).toBe(5000)
    expect(precioUnitarioDeTier({ tipo_valor: 'usd', precio: 10 }, 5000, 0)).toBe(5000)
    expect(precioUnitarioDeTier({ tipo_valor: 'usd', precio: 10 }, 5000, -1)).toBe(5000)
  })
})

describe('resolverBloquesTier — descuento por múltiplo de empaque ("el caso del pallet")', () => {
  const PRECIO_LISTA = 100
  const pallet = (extra: Partial<TierMayorista> = {}): TierMayorista => ({
    cantidad_minima: 1, precio: 10, operador: '>=', orden: 0,
    tipo_valor: 'pct', presentacion_factor: 2000, ...extra,
  })

  it('sin tiers → un solo bloque al precio de lista', () => {
    expect(resolverBloquesTier([], 500, PRECIO_LISTA)).toEqual([
      { cantidad: 500, precioUnitario: PRECIO_LISTA, tier: null },
    ])
  })

  it('tier normal (sin enlace): se comporta igual que antes, un solo bloque', () => {
    const normal: TierMayorista = { cantidad_minima: 50, precio: 90, operador: '>=', orden: 0, tipo_valor: 'precio_fijo' }
    const bloques = resolverBloquesTier([normal], 60, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 60, precioUnitario: 90, tier: normal }])
  })

  it('🛑 el pedido de Fede tal cual: 1 pallet (2000u) + 500 sueltas = DOS bloques separados', () => {
    const t = pallet()
    const bloques = resolverBloquesTier([t], 2500, PRECIO_LISTA)
    expect(bloques).toEqual([
      { cantidad: 2000, precioUnitario: 90, tier: t },   // pallet: 10% off sobre precio de lista
      { cantidad: 500, precioUnitario: PRECIO_LISTA, tier: null }, // sueltas: sin descuento (no matchea nada)
    ])
  })

  it('el descuento se multiplica para cualquier múltiplo EXACTO (2 pallets = 4000u, sin resto)', () => {
    const bloques = resolverBloquesTier([pallet()], 4000, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 4000, precioUnitario: 90, tier: expect.any(Object) }])
  })

  it('no llega a completar ni un pallet → no aplica, un solo bloque a precio de lista', () => {
    const bloques = resolverBloquesTier([pallet()], 1999, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 1999, precioUnitario: PRECIO_LISTA, tier: null }])
  })

  it('"no hace falta vender explícitamente por Pallet": aplica por cantidad exacta sea como sea que se cargó', () => {
    // 2000 unidades sueltas cargadas en una sola línea del carrito — mismo resultado que 1 pallet.
    const bloques = resolverBloquesTier([pallet()], 2000, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 2000, precioUnitario: 90, tier: expect.any(Object) }])
  })

  it('🛑 "compiten, gana el mejor precio": si el tier NORMAL da más barato para ese bloque, gana el normal', () => {
    const tierEmpaque = pallet({ precio: 5 }) // 5% off → $95/u
    const tierNormalMejor: TierMayorista = { cantidad_minima: 1500, precio: 85, operador: '>=', orden: 0, tipo_valor: 'precio_fijo' }
    const bloques = resolverBloquesTier([tierEmpaque, tierNormalMejor], 2500, PRECIO_LISTA)
    expect(bloques).toEqual([
      { cantidad: 2000, precioUnitario: 85, tier: tierNormalMejor }, // el normal gana el bloque del pallet
      { cantidad: 500, precioUnitario: PRECIO_LISTA, tier: null },  // las 500 sueltas no llegan a 1500 → sin tier
    ])
  })

  it('entre varios tiers ENLAZADOS que matchean a la vez, gana el de mejor precio', () => {
    const porCaja = pallet({ presentacion_factor: 10, precio: 5, orden: 0 })     // 5% off cada 10
    const porPallet = pallet({ presentacion_factor: 2000, precio: 15, orden: 1 }) // 15% off cada 2000
    const bloques = resolverBloquesTier([porCaja, porPallet], 2000, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 2000, precioUnitario: 85, tier: porPallet }])
  })

  it('% siempre se calcula sobre precio de LISTA, no sobre uno ya rebajado (aunque compitan)', () => {
    const bloques = resolverBloquesTier([pallet({ precio: 50 })], 2000, PRECIO_LISTA)
    expect(bloques[0].precioUnitario).toBe(50) // 50% de 100, no 50% de un precio ya menor
  })

  it('un tier usd enlazado a empaque se convierte a la cotización vigente', () => {
    const t = pallet({ tipo_valor: 'usd', precio: 0.08 }) // USD 0.08 × 1200 = $96/u
    const bloques = resolverBloquesTier([t], 2000, PRECIO_LISTA, 1200)
    expect(bloques).toEqual([{ cantidad: 2000, precioUnitario: 96, tier: t }])
  })

  it('un tier usd sin cotización cargada no se aplica (precio de lista)', () => {
    const t = pallet({ tipo_valor: 'usd', precio: 0.08 })
    const bloques = resolverBloquesTier([t], 2000, PRECIO_LISTA)
    expect(bloques).toEqual([{ cantidad: 2000, precioUnitario: PRECIO_LISTA, tier: t }])
  })
})

describe('mejorPrecioMayorista', () => {
  it('devuelve el precio más barato (para el canal que fuerza mayorista)', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 0 },
      { cantidad_minima: 50, precio: 80, operador: '>=', orden: 1 },
    ]
    expect(mejorPrecioMayorista(tiers, 100)).toBe(80)
  })
  it('sin tiers → null', () => {
    expect(mejorPrecioMayorista([], 100)).toBeNull()
  })
  it('un tier pct también compite, calculado sobre el precio de lista', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 0, tipo_valor: 'precio_fijo' },
      { cantidad_minima: 10, precio: 30, operador: '>=', orden: 1, tipo_valor: 'pct' }, // 30% off de 100 = 70
    ]
    expect(mejorPrecioMayorista(tiers, 100)).toBe(70)
  })
  it('ignora los tiers ENLAZADOS a empaque (dependen de comprar múltiplos, no de "forzar mayorista")', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 1, precio: 10, operador: '>=', orden: 0, tipo_valor: 'pct', presentacion_factor: 2000 },
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 1, tipo_valor: 'precio_fijo' },
    ]
    expect(mejorPrecioMayorista(tiers, 100)).toBe(90)
  })

  it('un tier usd compite convertido a la cotización vigente', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 0, tipo_valor: 'precio_fijo' },
      { cantidad_minima: 10, precio: 0.05, operador: '>=', orden: 1, tipo_valor: 'usd' }, // USD 0.05 × 1200 = $60
    ]
    expect(mejorPrecioMayorista(tiers, 100, 1200)).toBe(60)
  })
})

describe('precioBlendedTier', () => {
  const PRECIO_LISTA = 100

  it('sin tiers → precio de lista', () => {
    expect(precioBlendedTier([], 500, PRECIO_LISTA)).toBe(PRECIO_LISTA)
  })

  it('tier normal (sin enlace): da lo mismo que el precio de siempre — un solo bloque', () => {
    const normal: TierMayorista = { cantidad_minima: 50, precio: 90, operador: '>=', orden: 0, tipo_valor: 'precio_fijo' }
    expect(precioBlendedTier([normal], 60, PRECIO_LISTA)).toBe(90)
  })

  it('🛑 preserva la PLATA TOTAL exacta del pedido de Fede: 1 pallet (2000×$90) + 500×$100 = $230.000 → blended $92/u', () => {
    const t: TierMayorista = { cantidad_minima: 1, precio: 10, operador: '>=', orden: 0, tipo_valor: 'pct', presentacion_factor: 2000 }
    const blended = precioBlendedTier([t], 2500, PRECIO_LISTA)
    expect(blended).toBe(92)
    expect(blended * 2500).toBe(230000) // exacto: 2000×90 + 500×100
  })

  it('🛑 el total no cambia sin importar cómo se reparta la misma cantidad entre varias líneas del carrito', () => {
    const t: TierMayorista = { cantidad_minima: 1, precio: 10, operador: '>=', orden: 0, tipo_valor: 'pct', presentacion_factor: 2000 }
    const blended = precioBlendedTier([t], 2500, PRECIO_LISTA)
    // Repartido 1 sola línea de 2500, o 2 líneas (1000+1500), el total cobrado es el mismo.
    expect(2500 * blended).toBe((1000 + 1500) * blended)
    expect(2500 * blended).toBe(230000)
  })
})
