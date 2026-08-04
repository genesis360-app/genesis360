import { describe, it, expect } from 'vitest'
import { estadoCambioRequiereAprobacion } from '@/lib/aprobacionEstado'

describe('estadoCambioRequiereAprobacion', () => {
  const estadoConAprobacion = { requiere_aprobacion: true }
  const estadoSinAprobacion = { requiere_aprobacion: false }

  it('estado sin requiere_aprobacion → nunca exige, sin importar rol/config', () => {
    expect(estadoCambioRequiereAprobacion(estadoSinAprobacion, 'CAJERO', null)).toBe(false)
    expect(estadoCambioRequiereAprobacion(estadoSinAprobacion, 'DUEÑO', { CAJERO: 'siempre' })).toBe(false)
  })

  it('estado null/undefined → nunca exige', () => {
    expect(estadoCambioRequiereAprobacion(null, 'CAJERO', null)).toBe(false)
    expect(estadoCambioRequiereAprobacion(undefined, 'CAJERO', null)).toBe(false)
  })

  it('🛑 H2 — DUEÑO con config default (sin override) NO requiere aprobación (intencional, confirmado con GO)', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'DUEÑO', null)).toBe(false)
  })

  it('rol no-DUEÑO con config default (sin override) → modo "siempre", SÍ requiere', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'CAJERO', null)).toBe(true)
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'DEPOSITO', null)).toBe(true)
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'SUPERVISOR', null)).toBe(true)
  })

  it('override explícito del tenant: DUEÑO en modo "siempre" SÍ requiere', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'DUEÑO', { DUEÑO: 'siempre' })).toBe(true)
  })

  it('override explícito del tenant: un rol no-DUEÑO en modo "directo" NO requiere', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'DEPOSITO', { DEPOSITO: 'directo' })).toBe(false)
  })

  it('modo "umbral" NUNCA requiere para cambio de estado (siempre se llama con umbralRequiere=false — no hay "monto" contra el cual comparar un umbral)', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, 'CAJERO', { CAJERO: 'umbral' })).toBe(false)
  })

  it('rol null/undefined con config default → tratado como no-DUEÑO, requiere', () => {
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, null, null)).toBe(true)
    expect(estadoCambioRequiereAprobacion(estadoConAprobacion, undefined, null)).toBe(true)
  })
})
