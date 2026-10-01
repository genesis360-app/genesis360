import { describe, it, expect } from 'vitest'
import { PLANES, PRECIO_LISTA as LISTA_APP, ADDON_PACKS as PACKS_APP } from '@/config/brand'
import { PRECIO_DEBITO, PRECIO_LISTA, ADDON_PACKS, mrrDeTenant } from '../../supabase/functions/_shared/precios'

// El MRR del panel interno se calcula en el servidor con un ESPEJO de los precios de brand.ts. Si alguien cambia un
// precio en un solo lado, el MRR miente en silencio (pasó: salía de la tabla `planes` con precios viejos → ~$0).
describe('espejo de precios del servidor = brand.ts', () => {
  it('precio con débito por plan', () => {
    for (const tier of ['basico', 'pro']) {
      expect(PRECIO_DEBITO[tier], tier).toBe((PLANES as any[]).find(p => p.id === tier)?.precio)
    }
  })
  it('precio de lista por plan', () => {
    expect(PRECIO_LISTA).toEqual(LISTA_APP)
  })
  it('packs de add-on', () => {
    for (const [dim, cfg] of Object.entries(PACKS_APP)) expect(ADDON_PACKS[dim], dim).toEqual(cfg.packs)
  })
})

describe('mrrDeTenant', () => {
  it('manual: el monto congelado (lo que realmente se le cobra)', () => {
    expect(mrrDeTenant({ id: 't', plan_tier: 'basico', billing_mode: 'manual', manual_monto_mensual: '60000.00' }, [])).toBe(60000)
  })
  it('manual sin monto congelado: precio de lista + add-ons', () => {
    expect(mrrDeTenant({ id: 't', plan_tier: 'pro', billing_mode: 'manual', manual_monto_mensual: null },
      [{ dimension: 'usuarios', cantidad: 3 }])).toBe(110000)
  })
  it('automático: precio con débito + add-ons fijos', () => {
    expect(mrrDeTenant({ id: 't', plan_tier: 'basico', billing_mode: 'auto', manual_monto_mensual: null },
      [{ dimension: 'sku', cantidad: 2000 }, { dimension: 'cuits', cantidad: 1 }])).toBe(54000 + 10000 + 20000)
  })
  it('plan sin precio publicado (enterprise) → 0, se informa aparte', () => {
    expect(mrrDeTenant({ id: 't', plan_tier: 'enterprise', billing_mode: 'auto', manual_monto_mensual: null }, [])).toBe(0)
  })
})
