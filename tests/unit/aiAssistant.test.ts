import { describe, it, expect } from 'vitest'
import {
  scoreSeccion, seleccionarSecciones, construirSystemPrompt,
  type KnowledgeSection, type ContextoUsuario,
} from '@/lib/aiAssistant'

const sec = (over: Partial<KnowledgeSection>): KnowledgeSection => ({
  id: '3.1', titulo: 'X', ruta: null, keywords: [], contenido: 'contenido de prueba con largo suficiente', ...over,
})

const VENTAS = sec({ id: '3.2', titulo: 'Ventas / POS', ruta: '/ventas', keywords: ['venta', 'cobrar', 'presupuesto', 'medio de pago'] })
const CAJA = sec({ id: '3.4', titulo: 'Caja', ruta: '/caja', keywords: ['caja', 'arqueo', 'caja fuerte'] })
const INVENTARIO = sec({ id: '3.6', titulo: 'Inventario', ruta: '/inventario', keywords: ['stock', 'rebaje', 'ingreso de stock'] })
const FLUJO_DEV = sec({ id: '5.3', titulo: 'Proceso de devolución', ruta: null, keywords: ['devolucion', 'reembolso'] })
const TODAS = [VENTAS, CAJA, INVENTARIO, FLUJO_DEV]

describe('scoreSeccion', () => {
  it('matchea keywords normalizando tildes del usuario', () => {
    expect(scoreSeccion(FLUJO_DEV, '¿Cómo hago una DEVOLUCIÓN?')).toBeGreaterThan(0)
  })

  it('las frases exactas pesan más que las palabras sueltas', () => {
    const frase = scoreSeccion(VENTAS, 'qué medio de pago acepta')
    const palabra = scoreSeccion(VENTAS, 'quiero cobrar')
    expect(frase).toBeGreaterThan(palabra)
  })

  it('ignora keywords cortas (<4) para evitar falsos positivos', () => {
    const s = sec({ keywords: ['cc'] })
    expect(scoreSeccion(s, 'la cc del cliente')).toBe(0)
  })
})

describe('seleccionarSecciones', () => {
  it('la sección de la ruta actual va primero aunque no matchee keywords', () => {
    const r = seleccionarSecciones(TODAS, '/caja', 'pregunta sin keywords de nada')
    expect(r[0]).toBe(CAJA)
  })

  it('suma las secciones que matchean la pregunta, ordenadas por score', () => {
    const r = seleccionarSecciones(TODAS, '/caja', 'hice una venta y necesito la devolución')
    expect(r[0]).toBe(CAJA)
    expect(r).toContain(VENTAS)
    expect(r).toContain(FLUJO_DEV)
  })

  it('subrutas matchean por prefijo (ej. /productos/nuevo → /productos)', () => {
    const PROD = sec({ id: '3.5', titulo: 'Productos', ruta: '/productos', keywords: ['producto'] })
    const r = seleccionarSecciones([...TODAS, PROD], '/productos/nuevo', 'hola')
    expect(r[0]).toBe(PROD)
  })

  it('respeta el tope de caracteres (no arma prompts gigantes)', () => {
    const grande = sec({ id: '9.', titulo: 'Grande', ruta: null, keywords: ['stock'], contenido: 'x'.repeat(500) })
    const r = seleccionarSecciones([grande, INVENTARIO], undefined, 'stock', 600)
    const total = r.reduce((n, s) => n + s.contenido.length, 0)
    expect(total).toBeLessThanOrEqual(600)
  })

  it('máximo 4 secciones', () => {
    const muchas = Array.from({ length: 8 }, (_, i) =>
      sec({ id: `s${i}`, titulo: `S${i}`, ruta: null, keywords: ['stock'] }))
    expect(seleccionarSecciones(muchas, undefined, 'stock').length).toBeLessThanOrEqual(4)
  })
})

describe('construirSystemPrompt', () => {
  const ctx: ContextoUsuario = {
    rol: 'CAJERO', modoAvanzado: false, plan: 'basico', ruta: '/ventas',
    modulos: [
      { label: 'Ventas', ruta: '/ventas' },
      { label: 'Caja', ruta: '/caja' },
      { label: 'Reportes', ruta: '/reportes', bloqueadoPorPlan: true },
    ],
  }

  it('incluye el menú EXACTO del usuario con labels entre comillas', () => {
    const p = construirSystemPrompt(TODAS, ctx, 'hola')
    expect(p).toContain('- "Ventas"')
    expect(p).toContain('- "Caja"')
    expect(p).toContain('- "Reportes" (visible pero bloqueado por su plan)')
    expect(p).toContain('Rol: CAJERO')
    expect(p).toContain('BÁSICO')
  })

  it('incluye la sección de la pantalla actual y la regla de no inventar UI', () => {
    const p = construirSystemPrompt(TODAS, ctx, 'como cobro')
    expect(p).toContain('Ventas / POS')
    expect(p).toContain('NUNCA inventes botones')
    expect(p).toContain('Enviar reporte al equipo')
  })

  it('sin contexto: fallback que instruye a NO asumir el menú', () => {
    const p = construirSystemPrompt(TODAS, undefined, 'hola')
    expect(p).toContain('No se recibió el contexto')
    expect(p).not.toContain('Su menú lateral')
  })
})
