import { describe, it, expect } from 'vitest'
import { matchTier, precioTier, mejorPrecioMayorista, type TierMayorista } from '@/lib/tiers'

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

describe('mejorPrecioMayorista', () => {
  it('devuelve el precio más barato (para el canal que fuerza mayorista)', () => {
    const tiers: TierMayorista[] = [
      { cantidad_minima: 10, precio: 90, operador: '>=', orden: 0 },
      { cantidad_minima: 50, precio: 80, operador: '>=', orden: 1 },
    ]
    expect(mejorPrecioMayorista(tiers)).toBe(80)
  })
  it('sin tiers → null', () => {
    expect(mejorPrecioMayorista([])).toBeNull()
  })
})
