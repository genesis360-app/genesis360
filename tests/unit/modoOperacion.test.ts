import { describe, it, expect } from 'vitest'
import {
  esModoAvanzado, motivoBasico, productoRequiereTracking, sugiereModoAvanzado,
} from '@/lib/modoOperacion'

// Modo de operación Básico/Avanzado (mig 207) — decisiones GO 2026-06-12:
// avanzado = feature de plan Pro+ (trial lo prueba) · existentes → avanzado ·
// downgrade permitido con advertencia · el modo gatea UI, nunca datos.

describe('esModoAvanzado', () => {
  it('avanzado efectivo = toggle ON + plan lo permite', () => {
    expect(esModoAvanzado('avanzado', true)).toBe(true)
  })
  it('toggle ON pero plan insuficiente (venció trial / bajó de plan) → básico', () => {
    expect(esModoAvanzado('avanzado', false)).toBe(false)
  })
  it('toggle OFF → básico aunque el plan lo permita', () => {
    expect(esModoAvanzado('basico', true)).toBe(false)
    expect(esModoAvanzado('basico', false)).toBe(false)
  })
  it('valores nulos/desconocidos → básico (default seguro)', () => {
    expect(esModoAvanzado(null, true)).toBe(false)
    expect(esModoAvanzado(undefined, true)).toBe(false)
    expect(esModoAvanzado('cualquiera', true)).toBe(false)
  })
  it('kill-switch OFF → todos avanzado (rollback global, como antes de v1.55)', () => {
    expect(esModoAvanzado('basico', false, false)).toBe(true)
    expect(esModoAvanzado(null, false, false)).toBe(true)
    expect(esModoAvanzado('avanzado', true, false)).toBe(true)
  })
})

describe('motivoBasico', () => {
  it('avanzado efectivo → null (no hay motivo)', () => {
    expect(motivoBasico('avanzado', true)).toBe(null)
    expect(motivoBasico('basico', false, false)).toBe(null) // kill-switch off
  })
  it('toggle ON + plan insuficiente → plan_insuficiente', () => {
    expect(motivoBasico('avanzado', false)).toBe('plan_insuficiente')
  })
  it('toggle OFF → toggle_off (con o sin plan)', () => {
    expect(motivoBasico('basico', true)).toBe('toggle_off')
    expect(motivoBasico('basico', false)).toBe('toggle_off')
    expect(motivoBasico(null, true)).toBe('toggle_off')
  })
})

describe('productoRequiereTracking (regla de integridad en básico)', () => {
  it('producto con series, lote o vencimiento requiere tracking', () => {
    expect(productoRequiereTracking({ tiene_series: true })).toBe(true)
    expect(productoRequiereTracking({ tiene_lote: true })).toBe(true)
    expect(productoRequiereTracking({ tiene_vencimiento: true })).toBe(true)
    expect(productoRequiereTracking({ tiene_series: false, tiene_lote: true, tiene_vencimiento: false })).toBe(true)
  })
  it('producto simple (sin flags) no requiere', () => {
    expect(productoRequiereTracking({ tiene_series: false, tiene_lote: false, tiene_vencimiento: false })).toBe(false)
    expect(productoRequiereTracking({})).toBe(false)
    expect(productoRequiereTracking({ tiene_series: null, tiene_lote: null, tiene_vencimiento: null })).toBe(false)
  })
  it('producto nulo no requiere', () => {
    expect(productoRequiereTracking(null)).toBe(false)
    expect(productoRequiereTracking(undefined)).toBe(false)
  })
})

describe('sugiereModoAvanzado (post-onboarding)', () => {
  it('rubros con trazabilidad típica sugieren avanzado', () => {
    expect(sugiereModoAvanzado('Farmacia')).toBe(true)
    expect(sugiereModoAvanzado('Casa de repuestos')).toBe(true)
    expect(sugiereModoAvanzado('Electrónica / Tecnología')).toBe(true)
    expect(sugiereModoAvanzado('Veterinaria')).toBe(true)
  })
  it('rubros de mostrador no sugieren', () => {
    expect(sugiereModoAvanzado('Kiosco')).toBe(false)
    expect(sugiereModoAvanzado('Almacén')).toBe(false)
    expect(sugiereModoAvanzado('Verdulería / Frutería')).toBe(false)
    expect(sugiereModoAvanzado('Otro')).toBe(false)
  })
  it('tipo vacío/nulo no sugiere', () => {
    expect(sugiereModoAvanzado(null)).toBe(false)
    expect(sugiereModoAvanzado('')).toBe(false)
  })
})
