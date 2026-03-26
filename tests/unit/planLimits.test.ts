/**
 * planLimits.test.ts
 * Tests unitarios para la lógica de cálculo de límites de plan
 * (extrae la lógica pura de usePlanLimits para testearla sin Supabase).
 */
import { describe, test, expect } from 'vitest'
import { MAX_MOVIMIENTOS_POR_PLAN, FEATURES_POR_PLAN } from '@/config/brand'

// Replica la lógica de usePlanLimits sin hooks
function calcularLimites(opts: {
  plan_id: string
  max_users: number
  max_productos: number
  addon_movimientos: number
  subscription_status: string
  trial_ends_at: string | null
  usuarios_actuales: number
  productos_actuales: number
  movimientos_mes: number
}) {
  const {
    plan_id, max_users, max_productos, addon_movimientos,
    subscription_status, trial_ends_at,
    usuarios_actuales, productos_actuales, movimientos_mes,
  } = opts

  const basePlanMax = MAX_MOVIMIENTOS_POR_PLAN[plan_id] ?? MAX_MOVIMIENTOS_POR_PLAN['free']
  const max_movimientos = basePlanMax === -1 ? -1 : basePlanMax + addon_movimientos

  const enTrialActivo =
    subscription_status === 'trial' &&
    trial_ends_at !== null &&
    new Date(trial_ends_at) >= new Date()

  const featuresKey = enTrialActivo ? 'pro' : plan_id
  const features = FEATURES_POR_PLAN[featuresKey] ?? FEATURES_POR_PLAN['free']
  const tiene = (f: string) => features.includes(f)

  return {
    plan_id,
    max_usuarios: max_users,
    max_productos,
    max_movimientos,
    puede_crear_usuario: usuarios_actuales < max_users,
    puede_crear_producto: productos_actuales < max_productos,
    puede_crear_movimiento: max_movimientos === -1 || movimientos_mes < max_movimientos,
    pct_movimientos: max_movimientos === -1
      ? 0
      : Math.round((movimientos_mes / max_movimientos) * 100),
    puede_reportes:    tiene('reportes'),
    puede_historial:   tiene('historial'),
    puede_metricas:    tiene('metricas'),
    puede_importar:    tiene('importar'),
    puede_rrhh:        tiene('rrhh'),
    puede_aging:       tiene('aging'),
    puede_marketplace: tiene('marketplace'),
    enTrialActivo,
  }
}

describe('calcularLimites — plan Free', () => {
  const base = {
    plan_id: 'free', max_users: 1, max_productos: 50,
    addon_movimientos: 0, subscription_status: 'active', trial_ends_at: null,
    usuarios_actuales: 0, productos_actuales: 0, movimientos_mes: 0,
  }

  test('no puede reportes, historial ni metricas', () => {
    const l = calcularLimites(base)
    expect(l.puede_reportes).toBe(false)
    expect(l.puede_historial).toBe(false)
    expect(l.puede_metricas).toBe(false)
  })

  test('bloquea al llegar al límite de usuarios', () => {
    const l = calcularLimites({ ...base, usuarios_actuales: 1 })
    expect(l.puede_crear_usuario).toBe(false)
  })

  test('bloquea al llegar al límite de productos', () => {
    const l = calcularLimites({ ...base, productos_actuales: 50 })
    expect(l.puede_crear_producto).toBe(false)
  })

  test('bloquea movimientos al llegar al límite (200)', () => {
    const l = calcularLimites({ ...base, movimientos_mes: 200 })
    expect(l.puede_crear_movimiento).toBe(false)
    expect(l.pct_movimientos).toBe(100)
  })

  test('add-on de +500 extiende el límite de movimientos', () => {
    const l = calcularLimites({ ...base, addon_movimientos: 500, movimientos_mes: 200 })
    expect(l.max_movimientos).toBe(700)
    expect(l.puede_crear_movimiento).toBe(true)
    expect(l.pct_movimientos).toBe(Math.round(200 / 700 * 100))
  })
})

describe('calcularLimites — plan Básico', () => {
  const base = {
    plan_id: 'basico', max_users: 2, max_productos: 500,
    addon_movimientos: 0, subscription_status: 'active', trial_ends_at: null,
    usuarios_actuales: 0, productos_actuales: 0, movimientos_mes: 0,
  }

  test('puede reportes, historial y metricas', () => {
    const l = calcularLimites(base)
    expect(l.puede_reportes).toBe(true)
    expect(l.puede_historial).toBe(true)
    expect(l.puede_metricas).toBe(true)
  })

  test('no puede rrhh ni importar', () => {
    const l = calcularLimites(base)
    expect(l.puede_rrhh).toBe(false)
    expect(l.puede_importar).toBe(false)
  })

  test('límite de movimientos es 2000', () => {
    const l = calcularLimites(base)
    expect(l.max_movimientos).toBe(2000)
  })
})

describe('calcularLimites — plan Pro', () => {
  const base = {
    plan_id: 'pro', max_users: 10, max_productos: 5000,
    addon_movimientos: 0, subscription_status: 'active', trial_ends_at: null,
    usuarios_actuales: 0, productos_actuales: 0, movimientos_mes: 0,
  }

  test('puede todo (rrhh, importar, aging, marketplace)', () => {
    const l = calcularLimites(base)
    expect(l.puede_rrhh).toBe(true)
    expect(l.puede_importar).toBe(true)
    expect(l.puede_aging).toBe(true)
    expect(l.puede_marketplace).toBe(true)
  })

  test('movimientos ilimitados (pct = 0 siempre)', () => {
    const l = calcularLimites({ ...base, movimientos_mes: 99999 })
    expect(l.puede_crear_movimiento).toBe(true)
    expect(l.pct_movimientos).toBe(0)
  })
})

describe('calcularLimites — Trial activo', () => {
  const futuro = new Date(Date.now() + 7 * 86400000).toISOString()
  const pasado = new Date(Date.now() - 1000).toISOString()

  test('trial activo da acceso a features de Pro', () => {
    const l = calcularLimites({
      plan_id: 'free', max_users: 1, max_productos: 50,
      addon_movimientos: 0, subscription_status: 'trial', trial_ends_at: futuro,
      usuarios_actuales: 0, productos_actuales: 0, movimientos_mes: 0,
    })
    expect(l.enTrialActivo).toBe(true)
    expect(l.puede_rrhh).toBe(true)
    expect(l.puede_importar).toBe(true)
  })

  test('trial vencido NO da acceso a Pro', () => {
    const l = calcularLimites({
      plan_id: 'free', max_users: 1, max_productos: 50,
      addon_movimientos: 0, subscription_status: 'trial', trial_ends_at: pasado,
      usuarios_actuales: 0, productos_actuales: 0, movimientos_mes: 0,
    })
    expect(l.enTrialActivo).toBe(false)
    expect(l.puede_rrhh).toBe(false)
  })
})
