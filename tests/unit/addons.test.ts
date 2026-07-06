/**
 * addons.test.ts — Pricing 2026 Fase 2/3
 * Packs de add-on + serialización del external_reference (fuente de verdad UI↔webhook).
 */
import { describe, test, expect } from 'vitest'
import {
  packsDe, tiposDe, findAddonPack, tipoValido,
  buildAddonRef, parseAddonRef,
  precioMensualAddonsFijos, evaluarDowngrade,
} from '@/lib/addons'

const TENANT = '5f05f3eb-6757-4f60-b9d2-8853fdfae806'

describe('packs por dimensión', () => {
  test('comprobantes tiene 3 packs (1.000/$10k · 5.000/$30k · 10.000/$50k) — pricing v2 GO', () => {
    expect(packsDe('comprobantes')).toEqual([
      { cantidad: 1000, precio: 10000 },
      { cantidad: 5000, precio: 30000 },
      { cantidad: 10000, precio: 50000 },
    ])
  })

  test('comprobantes admite fijo Y temporal; sucursales solo fijo; movimientos ya NO está en catálogo', () => {
    expect(tiposDe('comprobantes')).toEqual(['fijo', 'temporal'])
    expect(tiposDe('sucursales')).toEqual(['fijo'])
    expect(tipoValido('comprobantes', 'temporal')).toBe(true)
    expect(tipoValido('sucursales', 'temporal')).toBe(false)
    expect(tipoValido('usuarios', 'temporal')).toBe(false)
    expect(tipoValido('sku', 'temporal')).toBe(false)
    expect(packsDe('movimientos')).toEqual([])           // sin packs → no se puede comprar más
    expect(tipoValido('movimientos', 'temporal')).toBe(false)
  })
})

describe('findAddonPack — el precio SOLO sale del catálogo', () => {
  test('cantidad exacta devuelve el precio de lista', () => {
    expect(findAddonPack('comprobantes', 5000)).toEqual({ cantidad: 5000, precio: 30000 })
    expect(findAddonPack('sucursales', 1)).toEqual({ cantidad: 1, precio: 15000 })
  })

  test('cantidad inexistente → null (precio no confiable, no cobrar)', () => {
    expect(findAddonPack('comprobantes', 3333)).toBeNull()
    expect(findAddonPack('comprobantes', 0)).toBeNull()
    expect(findAddonPack('sucursales', 2)).toBeNull()
    expect(findAddonPack('movimientos', 5000)).toBeNull() // catálogo v2: sin packs de movimientos
  })
})

describe('buildAddonRef / parseAddonRef — round-trip', () => {
  test('serializa y parsea de vuelta', () => {
    const ref = buildAddonRef(TENANT, 'movimientos', 5000, 'temporal')
    expect(ref).toBe(`${TENANT}|addon|movimientos|5000|temporal`)
    expect(parseAddonRef(ref)).toEqual({ tenantId: TENANT, dimension: 'movimientos', cantidad: 5000, tipo: 'temporal' })
  })

  test('parsea todas las dimensiones y tipos', () => {
    expect(parseAddonRef(buildAddonRef(TENANT, 'sku', 2000, 'fijo'))).toMatchObject({ dimension: 'sku', cantidad: 2000, tipo: 'fijo' })
    expect(parseAddonRef(buildAddonRef(TENANT, 'usuarios', 3, 'fijo'))).toMatchObject({ dimension: 'usuarios', cantidad: 3, tipo: 'fijo' })
  })

  test('rechaza refs que no son add-on o están mal formadas', () => {
    expect(parseAddonRef(`${TENANT}|addon_movimientos`)).toBeNull()   // formato legacy
    expect(parseAddonRef(TENANT)).toBeNull()                          // suscripción (solo tenant id)
    expect(parseAddonRef(`${TENANT}|addon|movimientos|5000`)).toBeNull()      // falta tipo
    expect(parseAddonRef(`${TENANT}|addon|inventado|5000|fijo`)).toBeNull()   // dimensión inválida
    expect(parseAddonRef(`${TENANT}|addon|movimientos|abc|fijo`)).toBeNull()  // cantidad no numérica
    expect(parseAddonRef(`${TENANT}|addon|movimientos|-5|fijo`)).toBeNull()   // cantidad negativa
    expect(parseAddonRef(`${TENANT}|addon|movimientos|5000|otro`)).toBeNull() // tipo inválido
  })
})

describe('precioMensualAddonsFijos', () => {
  test('suma solo los fijos, ignora temporales', () => {
    const total = precioMensualAddonsFijos([
      { dimension: 'sucursales', cantidad: 1, tipo: 'fijo' },    // $15.000
      { dimension: 'usuarios', cantidad: 3, tipo: 'fijo' },      // $10.000
      { dimension: 'movimientos', cantidad: 5000, tipo: 'temporal' }, // NO cuenta (temporal)
    ])
    expect(total).toBe(25000)
  })

  test('lista vacía = 0; pack inexistente se ignora', () => {
    expect(precioMensualAddonsFijos([])).toBe(0)
    expect(precioMensualAddonsFijos([{ dimension: 'sku', cantidad: 12345, tipo: 'fijo' }])).toBe(0)
  })
})

describe('evaluarDowngrade — guiado (REGLA #0: desactivar antes de bajar)', () => {
  test('sin excedente → se puede bajar directo', () => {
    // Básico SKU base 2.000 + add-on 2.000 = 4.000; usa 1.500; quita el pack de 2.000 → nuevo 2.000
    const r = evaluarDowngrade({ base: 2000, totalAddonsActivos: 2000, cantidadARemover: 2000, usoActual: 1500 })
    expect(r).toEqual({ nuevoLimite: 2000, excedente: 0, puedeRemover: true })
  })

  test('con excedente → bloquea y dice cuántos desactivar', () => {
    // base 2.000 + add-on 2.000 = 4.000; usa 3.200; quita 2.000 → nuevo 2.000 → sobran 1.200
    const r = evaluarDowngrade({ base: 2000, totalAddonsActivos: 2000, cantidadARemover: 2000, usoActual: 3200 })
    expect(r.nuevoLimite).toBe(2000)
    expect(r.excedente).toBe(1200)
    expect(r.puedeRemover).toBe(false)
  })

  test('sucursales: quitar 1 de 3 add-on con uso justo en el borde', () => {
    // Pro sucursales base 4 + add-on 3 = 7; usa 5; quita 1 → nuevo 6 → sin excedente
    const r = evaluarDowngrade({ base: 4, totalAddonsActivos: 3, cantidadARemover: 1, usoActual: 5 })
    expect(r.nuevoLimite).toBe(6)
    expect(r.puedeRemover).toBe(true)
  })

  test('tier ilimitado (enterprise) siempre puede bajar', () => {
    const r = evaluarDowngrade({ base: -1, totalAddonsActivos: 0, cantidadARemover: 0, usoActual: 99999 })
    expect(r).toEqual({ nuevoLimite: -1, excedente: 0, puedeRemover: true })
  })
})
