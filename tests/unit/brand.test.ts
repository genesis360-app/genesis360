/**
 * brand.test.ts
 * Sanity checks de las constantes de configuración del plan.
 * Verifican que los límites y feature flags son coherentes.
 */
import { describe, test, expect } from 'vitest'
import { PLANES, FEATURES_POR_PLAN, PLAN_REQUERIDO, PLAN_BASE_LIMITS } from '@/config/brand'

describe('PLANES — estructura y coherencia', () => {
  test('existen los 4 planes requeridos', () => {
    const ids = PLANES.map(p => p.id)
    expect(ids).toContain('free')
    expect(ids).toContain('basico')
    expect(ids).toContain('pro')
    expect(ids).toContain('enterprise')
  })

  test('free es el más barato (precio 0)', () => {
    const free = PLANES.find(p => p.id === 'free')!
    expect(free.precio).toBe(0)
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

  test('pro incluye rrhh e importar', () => {
    const proFeatures = FEATURES_POR_PLAN['pro'] ?? []
    expect(proFeatures).toContain('rrhh')
    expect(proFeatures).toContain('importar')
  })
})

describe('PLAN_BASE_LIMITS — pricing v2 (espejo de fn_plan_base_limite, migs 251+259)', () => {
  test('comprobantes: free 200 · basico 6.000 · pro 14.000 · enterprise -1 (decisión GO 2026-07-05)', () => {
    expect(PLAN_BASE_LIMITS['free'].comprobantes).toBe(200)
    expect(PLAN_BASE_LIMITS['basico'].comprobantes).toBe(6000)
    expect(PLAN_BASE_LIMITS['pro'].comprobantes).toBe(14000)
    expect(PLAN_BASE_LIMITS['enterprise'].comprobantes).toBe(-1)
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

  test('enterprise es ilimitado (-1) en todas las dimensiones', () => {
    for (const d of ['sku', 'movimientos', 'comprobantes', 'sucursales', 'usuarios'] as const) {
      expect(PLAN_BASE_LIMITS['enterprise'][d]).toBe(-1)
    }
  })
})

describe('PLAN_REQUERIDO', () => {
  test('reportes, historial y metricas requieren al menos basico', () => {
    expect(PLAN_REQUERIDO['reportes']).toBe('basico')
    expect(PLAN_REQUERIDO['historial']).toBe('basico')
    expect(PLAN_REQUERIDO['metricas']).toBe('basico')
  })

  test('rrhh, importar, aging y marketplace requieren pro', () => {
    expect(PLAN_REQUERIDO['rrhh']).toBe('pro')
    expect(PLAN_REQUERIDO['importar']).toBe('pro')
    expect(PLAN_REQUERIDO['aging']).toBe('pro')
    expect(PLAN_REQUERIDO['marketplace']).toBe('pro')
  })
})
