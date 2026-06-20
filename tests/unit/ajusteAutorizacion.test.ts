import { describe, it, expect } from 'vitest'
import { modoAjusteRol, requiereAuthAjuste } from '@/lib/ajusteAutorizacion'

describe('ajusteAutorizacion — modoAjusteRol (defaults)', () => {
  it('DUEÑO sin config → directo', () => {
    expect(modoAjusteRol('DUEÑO', null)).toBe('directo')
  })
  it('cualquier otro rol sin config → siempre', () => {
    expect(modoAjusteRol('SUPERVISOR', null)).toBe('siempre')
    expect(modoAjusteRol('CAJERO', undefined)).toBe('siempre')
    expect(modoAjusteRol('DEPOSITO', {})).toBe('siempre')
  })
  it('rol sin entrada en la config → default por rol', () => {
    expect(modoAjusteRol('DUEÑO', { SUPERVISOR: 'directo' })).toBe('directo')
    expect(modoAjusteRol('CAJERO', { SUPERVISOR: 'directo' })).toBe('siempre')
  })
  it('config explícita gana sobre el default', () => {
    expect(modoAjusteRol('SUPERVISOR', { SUPERVISOR: 'directo' })).toBe('directo')
    expect(modoAjusteRol('SUPERVISOR', { SUPERVISOR: 'umbral' })).toBe('umbral')
    expect(modoAjusteRol('DUEÑO', { 'DUEÑO': 'siempre' })).toBe('siempre')
  })
  it('valor inválido en config → cae al default', () => {
    expect(modoAjusteRol('SUPERVISOR', { SUPERVISOR: 'xxx' as any })).toBe('siempre')
  })
})

describe('ajusteAutorizacion — requiereAuthAjuste', () => {
  it('directo (DUEÑO default) nunca requiere, aunque el umbral diga que sí', () => {
    expect(requiereAuthAjuste('DUEÑO', null, true)).toBe(false)
    expect(requiereAuthAjuste('DUEÑO', null, false)).toBe(false)
  })
  it('siempre (resto default) siempre requiere, aunque el umbral diga que no', () => {
    expect(requiereAuthAjuste('CAJERO', null, false)).toBe(true)
    expect(requiereAuthAjuste('SUPERVISOR', null, true)).toBe(true)
  })
  it('umbral delega en el gate por umbral', () => {
    const cfg = { SUPERVISOR: 'umbral' as const }
    expect(requiereAuthAjuste('SUPERVISOR', cfg, true)).toBe(true)
    expect(requiereAuthAjuste('SUPERVISOR', cfg, false)).toBe(false)
  })
  it('config puede dejar a un rol como el dueño (directo)', () => {
    const cfg = { SUPERVISOR: 'directo' as const }
    expect(requiereAuthAjuste('SUPERVISOR', cfg, true)).toBe(false)
  })
})
