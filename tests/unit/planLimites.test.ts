// Pricing v7 (mig 457) — espejo de fn_tenant_limite en la app: límites v7 + herencia v6 de los negocios existentes.
import { describe, it, expect } from 'vitest'
import { featuresEfectivas, limiteBase, limiteEfectivo, tierEfectivo, type HerenciaPlan } from '@/lib/planLimites'

const HER_PRO_V6: HerenciaPlan = {
  tier_heredado: 'pro',
  limites: { usuarios: 15, sku: 8000, comprobantes: 14000, sucursales: 4, cuits: 1, movimientos: -1 },
  features: ['ventas', 'caja', 'gastos', 'clientes', 'inventario', 'movimientos', 'alertas', 'reportes', 'historial', 'metricas', 'importar', 'rrhh', 'aging', 'marketplace', 'wms'],
}
const now = new Date('2026-10-02T12:00:00Z')

describe('tierEfectivo (igual que la base)', () => {
  it('prueba vigente → pro; vencida o pago → su plan', () => {
    expect(tierEfectivo({ planTier: 'basico', subscriptionStatus: 'trial', trialEndsAt: '2026-10-10', now })).toBe('pro')
    expect(tierEfectivo({ planTier: 'free', subscriptionStatus: 'trial', trialEndsAt: '2026-09-24', now })).toBe('free')
    expect(tierEfectivo({ planTier: 'basico', subscriptionStatus: 'active', trialEndsAt: null, now })).toBe('basico')
  })
})

describe('límites v7 para los negocios nuevos (sin herencia)', () => {
  it('Básico 3 usuarios / 5.000 comprob.; Pro 7 / 2 suc. / 2 CUITs; Enterprise 20 / 4 suc. (ya no ilimitado)', () => {
    expect(limiteBase('basico', 'usuarios')).toBe(3)
    expect(limiteBase('basico', 'comprobantes')).toBe(5000)
    expect(limiteBase('pro', 'usuarios')).toBe(7)
    expect(limiteBase('pro', 'sucursales')).toBe(2)
    expect(limiteBase('pro', 'cuits')).toBe(2)
    expect(limiteBase('enterprise', 'usuarios')).toBe(20)
    expect(limiteBase('enterprise', 'sku')).toBe(18000)
  })
  it('add-ons se suman; movimientos sigue ilimitado', () => {
    expect(limiteEfectivo('basico', 'usuarios', 3)).toBe(6)
    expect(limiteEfectivo('pro', 'movimientos', 0)).toBe(-1)
  })
})

describe('herencia v6 de los negocios existentes (GO: "mantienen lo que tienen")', () => {
  it('en prueba heredan Pro v6: aunque paguen Básico v7 conservan 15 usuarios y 4 sucursales', () => {
    expect(limiteBase('basico', 'usuarios', HER_PRO_V6)).toBe(15)
    expect(limiteBase('basico', 'sucursales', HER_PRO_V6)).toBe(4)
    expect(limiteBase('pro', 'sku', HER_PRO_V6)).toBe(8000)
  })
  it('si el plan v7 es mayor, manda el v7 (Enterprise 20 usuarios > 15 heredados); los add-ons se suman encima', () => {
    expect(limiteBase('enterprise', 'usuarios', HER_PRO_V6)).toBe(20)
    expect(limiteEfectivo('basico', 'usuarios', 2, HER_PRO_V6)).toBe(17)
  })
  it('una herencia ilimitada (Enterprise v6) sigue ilimitada', () => {
    expect(limiteBase('basico', 'usuarios', { tier_heredado: 'enterprise', limites: { usuarios: -1 }, features: [] })).toBe(-1)
  })
  it('conservan los módulos: con Básico v7 siguen teniendo WMS, RRHH y marketplace', () => {
    const f = featuresEfectivas('basico', HER_PRO_V6)
    expect(f).toEqual(expect.arrayContaining(['wms', 'rrhh', 'marketplace', 'importar']))
  })
  it('sin herencia, Pro v7 ya no trae RRHH ni marketplace (pasan a Enterprise)', () => {
    expect(featuresEfectivas('pro')).not.toContain('rrhh')
    expect(featuresEfectivas('pro')).not.toContain('marketplace')
    expect(featuresEfectivas('enterprise')).toEqual(expect.arrayContaining(['rrhh', 'marketplace']))
  })
})
