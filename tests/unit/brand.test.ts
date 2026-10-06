/**
 * brand.test.ts
 * Sanity checks de las constantes de configuración del plan.
 * Verifican que los límites y feature flags son coherentes.
 */
import { describe, test, expect } from 'vitest'
import { PLANES, FEATURES_POR_PLAN, PLAN_REQUERIDO, PLAN_BASE_LIMITS } from '@/config/brand'

describe('PLANES — estructura y coherencia', () => {
  test('pricing v7: Básico, Pro y Enterprise; ya no hay plan Free (la prueba de 30 días es el período gratis)', () => {
    expect(PLANES.map(p => p.id)).toEqual(['basico', 'pro', 'enterprise'])
  })

  test('precios v7 con débito automático y de lista (docs de Fede)', () => {
    const precio = (id: string) => PLANES.find(p => p.id === id) as any
    expect([precio('basico').precio, precio('basico').precioManual]).toEqual([54000, 60000])
    expect([precio('pro').precio, precio('pro').precioManual]).toEqual([100000, 117600])
    expect([precio('enterprise').precio, precio('enterprise').precioManual]).toEqual([200000, 250000])
  })

  test('pro tiene más usuarios que basico', () => {
    const basico = PLANES.find(p => p.id === 'basico')!
    const pro    = PLANES.find(p => p.id === 'pro')!
    expect(pro.limites.usuarios).toBeGreaterThan(basico.limites.usuarios)
  })

  test('pro tiene más productos que basico', () => {
    const basico = PLANES.find(p => p.id === 'basico')!
    const pro    = PLANES.find(p => p.id === 'pro')!
    expect(pro.limites.productos).toBeGreaterThan(basico.limites.productos)
  })

  test('débito escalonado: Básico −10 %, Pro ≈−15 %, Enterprise −20 % sobre el precio de lista', () => {
    const desc = (id: string) => { const p = PLANES.find(x => x.id === id) as any; return 1 - p.precio / p.precioManual }
    expect(desc('basico')).toBeCloseTo(0.10, 2)
    expect(desc('pro')).toBeCloseTo(0.15, 2)
    expect(desc('enterprise')).toBeCloseTo(0.20, 2)
  })
})

describe('FEATURES_POR_PLAN — reglas de acceso', () => {
  test('pro incluye todas las features de basico', () => {
    const basicoFeatures = FEATURES_POR_PLAN['basico'] ?? []
    const proFeatures    = FEATURES_POR_PLAN['pro'] ?? []
    for (const f of basicoFeatures) {
      expect(proFeatures).toContain(f)
    }
  })

  test('enterprise incluye todas las features de pro', () => {
    const proFeatures   = FEATURES_POR_PLAN['pro'] ?? []
    const entFeatures   = FEATURES_POR_PLAN['enterprise'] ?? []
    for (const f of proFeatures) {
      expect(entFeatures).toContain(f)
    }
  })

  test('free no incluye reportes ni historial', () => {
    const freeFeatures = FEATURES_POR_PLAN['free'] ?? []
    expect(freeFeatures).not.toContain('reportes')
    expect(freeFeatures).not.toContain('historial')
  })

  test('basico incluye reportes e historial', () => {
    const basicoFeatures = FEATURES_POR_PLAN['basico'] ?? []
    expect(basicoFeatures).toContain('reportes')
    expect(basicoFeatures).toContain('historial')
  })

  test('v7: pro incluye importar y WMS; RRHH y marketplace pasan a enterprise', () => {
    const proFeatures = FEATURES_POR_PLAN['pro'] ?? []
    expect(proFeatures).toEqual(expect.arrayContaining(['importar', 'wms']))
    expect(proFeatures).not.toContain('rrhh')
    expect(proFeatures).not.toContain('marketplace')
    expect(FEATURES_POR_PLAN['enterprise']).toEqual(expect.arrayContaining(['rrhh', 'marketplace']))
  })
})

describe('PLAN_BASE_LIMITS — pricing v7 (espejo de fn_plan_base_limite, mig 457)', () => {
  test('comprobantes: basico 5.000 · pro 13.000 · enterprise 30.000 (free 200 = legacy)', () => {
    expect(PLAN_BASE_LIMITS['free'].comprobantes).toBe(200)
    expect(PLAN_BASE_LIMITS['basico'].comprobantes).toBe(5000)
    expect(PLAN_BASE_LIMITS['pro'].comprobantes).toBe(13000)
    expect(PLAN_BASE_LIMITS['enterprise'].comprobantes).toBe(30000)
  })

  test('CUITs incluidos van 1 a 1 con las sucursales del plan', () => {
    for (const t of ['basico', 'pro', 'enterprise']) {
      expect(PLAN_BASE_LIMITS[t].cuits).toBe(PLAN_BASE_LIMITS[t].sucursales)
    }
  })

  test('movimientos dejó de ser límite: -1 en TODOS los tiers (pricing v2)', () => {
    for (const t of ['free', 'basico', 'pro', 'enterprise']) {
      expect(PLAN_BASE_LIMITS[t].movimientos).toBe(-1)
    }
  })

  test('pro > basico en cada dimensión metered', () => {
    for (const d of ['sku', 'comprobantes', 'sucursales', 'usuarios'] as const) {
      expect(PLAN_BASE_LIMITS['pro'][d]).toBeGreaterThan(PLAN_BASE_LIMITS['basico'][d])
    }
  })

  test('v7: enterprise deja de ser ilimitado (20 usuarios · 18.000 productos · 4 sucursales) y es > pro en todo', () => {
    expect(PLAN_BASE_LIMITS['enterprise']).toMatchObject({ usuarios: 20, sku: 18000, sucursales: 4, comprobantes: 30000 })
    for (const d of ['sku', 'comprobantes', 'sucursales', 'usuarios'] as const) {
      expect(PLAN_BASE_LIMITS['enterprise'][d]).toBeGreaterThan(PLAN_BASE_LIMITS['pro'][d])
    }
  })
})

describe('PLAN_REQUERIDO', () => {
  test('reportes, historial y metricas requieren al menos basico', () => {
    expect(PLAN_REQUERIDO['reportes']).toBe('basico')
    expect(PLAN_REQUERIDO['historial']).toBe('basico')
    expect(PLAN_REQUERIDO['metricas']).toBe('basico')
  })

  test('v7: importar, aging y WMS requieren pro; RRHH y marketplace requieren enterprise', () => {
    expect(PLAN_REQUERIDO['importar']).toBe('pro')
    expect(PLAN_REQUERIDO['aging']).toBe('pro')
    expect(PLAN_REQUERIDO['wms']).toBe('pro')
    expect(PLAN_REQUERIDO['rrhh']).toBe('enterprise')
    expect(PLAN_REQUERIDO['marketplace']).toBe('enterprise')
  })
})
