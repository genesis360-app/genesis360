import { describe, it, expect } from 'vitest'
import { debeIrArriba } from '../../src/components/ScrollAlInicio'

// 🐛 GO 2026-10-07: desde el pie de la landing, abrir /terminos o /para/dieteticas dejaba la página nueva abajo de todo.
describe('debeIrArriba', () => {
  it('link a una página pública → arriba', () => {
    expect(debeIrArriba('/terminos', '', 'PUSH')).toBe(true)
    expect(debeIrArriba('/para/dieteticas', '', 'PUSH')).toBe(true)
    expect(debeIrArriba('/onboarding', '', 'PUSH')).toBe(true)
  })

  it('redirección (REPLACE) a una pública → arriba', () => {
    expect(debeIrArriba('/login', '', 'REPLACE')).toBe(true)
  })

  it('"Atrás" (POP) → no se toca: el navegador restaura donde estaba', () => {
    expect(debeIrArriba('/', '', 'POP')).toBe(false)
  })

  it('link con #ancla → no se toca: quiere ir a esa sección', () => {
    expect(debeIrArriba('/', '#precios', 'PUSH')).toBe(false)
  })

  it('pantallas de la app (con sesión) → no se tocan', () => {
    expect(debeIrArriba('/ventas', '', 'PUSH')).toBe(false)
    expect(debeIrArriba('/dashboard', '', 'REPLACE')).toBe(false)
  })
})
