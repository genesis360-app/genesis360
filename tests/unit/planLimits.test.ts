/**
 * planLimits.test.ts — pricing v2 (GO 2026-07-05)
 * Lógica pura de límites de plan (espejo de usePlanLimits, sin Supabase):
 * dimensión de flujo = COMPROBANTES (soft — solo avisa, nunca bloquea una venta);
 * movimientos dejó de ser límite (-1 siempre). Features por tier + trial→Pro.
 */
import { describe, test, expect } from 'vitest'
import { PLAN_BASE_LIMITS, FEATURES_POR_PLAN } from '@/config/brand'

// Réplica de la lógica de usePlanLimits sin hooks (base + add-ons; trial activo → pro)
function calcularLimites(opts: {
  plan_id: string
  addon_comprobantes: number
  subscription_status: string
  trial_ends_at: string | null
  usuarios_actuales: number
  productos_actuales: number
  comprobantes_mes: number
}) {
  const {
    plan_id, addon_comprobantes, subscription_status, trial_ends_at,
    usuarios_actuales, productos_actuales, comprobantes_mes,
  } = opts

  const enTrialActivo =
    subscription_status === 'trial' &&
    trial_ends_at !== null &&
    new Date(trial_ends_at) >= new Date()
  const effTier = enTrialActivo ? 'pro' : plan_id
  const base = PLAN_BASE_LIMITS[effTier] ?? PLAN_BASE_LIMITS['free']

  const eff = (v: number, addons = 0) => (v === -1 ? -1 : v + addons)
  const max_usuarios = eff(base.usuarios)
  const max_productos = eff(base.sku)
  const max_movimientos = eff(base.movimientos)
  const max_comprobantes = eff(base.comprobantes, addon_comprobantes)

  const features = FEATURES_POR_PLAN[effTier] ?? FEATURES_POR_PLAN['free']
  const tiene = (f: string) => features.includes(f)

  return {
    max_usuarios, max_productos, max_movimientos, max_comprobantes,
    puede_crear_usuario: max_usuarios === -1 || usuarios_actuales < max_usuarios,
    puede_crear_producto: max_productos === -1 || productos_actuales < max_productos,
    pct_comprobantes: max_comprobantes === -1 ? 0 : Math.round((comprobantes_mes / max_comprobantes) * 100),
    puede_reportes: tiene('reportes'), puede_historial: tiene('historial'),
    puede_metricas: tiene('metricas'), puede_importar: tiene('importar'),
    puede_rrhh: tiene('rrhh'), puede_aging: tiene('aging'), puede_marketplace: tiene('marketplace'),
    enTrialActivo,
  }
}

const base = {
  addon_comprobantes: 0, subscription_status: 'active', trial_ends_at: null as string | null,
  usuarios_actuales: 0, productos_actuales: 0, comprobantes_mes: 0,
}

describe('calcularLimites — plan Free', () => {
  test('no puede reportes, historial ni metricas', () => {
    const l = calcularLimites({ ...base, plan_id: 'free' })
    expect(l.puede_reportes).toBe(false)
    expect(l.puede_historial).toBe(false)
    expect(l.puede_metricas).toBe(false)
  })

  test('bloquea al llegar al límite de usuarios (1)', () => {
    expect(calcularLimites({ ...base, plan_id: 'free', usuarios_actuales: 1 }).puede_crear_usuario).toBe(false)
  })

  test('bloquea al llegar al límite de productos (50)', () => {
    expect(calcularLimites({ ...base, plan_id: 'free', productos_actuales: 50 }).puede_crear_producto).toBe(false)
  })

  test('comprobantes al 100% (200/200) — SOFT: solo pct, nunca "puede_crear=false"', () => {
    const l = calcularLimites({ ...base, plan_id: 'free', comprobantes_mes: 200 })
    expect(l.max_comprobantes).toBe(200)
    expect(l.pct_comprobantes).toBe(100)
  })

  test('movimientos ya NO es límite (-1 en todos los tiers)', () => {
    expect(calcularLimites({ ...base, plan_id: 'free' }).max_movimientos).toBe(-1)
  })
})

describe('calcularLimites — plan Básico', () => {
  test('puede reportes, historial y metricas; no rrhh ni importar', () => {
    const l = calcularLimites({ ...base, plan_id: 'basico' })
    expect(l.puede_reportes).toBe(true)
    expect(l.puede_historial).toBe(true)
    expect(l.puede_metricas).toBe(true)
    expect(l.puede_rrhh).toBe(false)
    expect(l.puede_importar).toBe(false)
  })

  test('límite de comprobantes es 6.000 (decisión GO 2026-07-05)', () => {
    expect(calcularLimites({ ...base, plan_id: 'basico' }).max_comprobantes).toBe(6000)
  })

  test('add-on de comprobantes extiende el límite (6.000 + 1.000)', () => {
    const l = calcularLimites({ ...base, plan_id: 'basico', addon_comprobantes: 1000, comprobantes_mes: 6500 })
    expect(l.max_comprobantes).toBe(7000)
    expect(l.pct_comprobantes).toBe(Math.round(6500 / 7000 * 100))
  })
})

describe('calcularLimites — plan Pro', () => {
  test('puede todo (rrhh, importar, aging, marketplace)', () => {
    const l = calcularLimites({ ...base, plan_id: 'pro' })
    expect(l.puede_rrhh).toBe(true)
    expect(l.puede_importar).toBe(true)
    expect(l.puede_aging).toBe(true)
    expect(l.puede_marketplace).toBe(true)
  })

  test('comprobantes limitados a 14.000; enterprise ilimitado', () => {
    expect(calcularLimites({ ...base, plan_id: 'pro' }).max_comprobantes).toBe(14000)
    expect(calcularLimites({ ...base, plan_id: 'enterprise' }).max_comprobantes).toBe(-1)
  })
})

describe('calcularLimites — Trial activo', () => {
  const futuro = new Date(Date.now() + 7 * 86400000).toISOString()
  const pasado = new Date(Date.now() - 1000).toISOString()

  test('trial activo da acceso a features (y límites) de Pro', () => {
    const l = calcularLimites({ ...base, plan_id: 'free', subscription_status: 'trial', trial_ends_at: futuro })
    expect(l.enTrialActivo).toBe(true)
    expect(l.puede_rrhh).toBe(true)
    expect(l.max_comprobantes).toBe(14000)
  })

  test('trial vencido NO da acceso a Pro', () => {
    const l = calcularLimites({ ...base, plan_id: 'free', subscription_status: 'trial', trial_ends_at: pasado })
    expect(l.enTrialActivo).toBe(false)
    expect(l.puede_rrhh).toBe(false)
  })
})
