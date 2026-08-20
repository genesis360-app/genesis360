import { describe, it, expect } from 'vitest'
import {
  scoreSeccion, seleccionarSecciones, construirSystemPrompt, esReintentable,
  construirToolPropuestaConfig, validarPropuestaConfig, CONFIG_CAMPOS_IA,
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

  it('nombrar el módulo por su título suma boost (aunque no haya keywords)', () => {
    const FACT = sec({ titulo: 'Facturación', keywords: [] })
    expect(scoreSeccion(FACT, '¿dónde está facturación?')).toBe(2)
  })

  it('el boost de título recorta lo que sigue a "(" y "/"', () => {
    // "Ventas / POS" → boost por "ventas" solo
    expect(scoreSeccion(sec({ titulo: 'Ventas / POS', keywords: [] }), 'el módulo de ventas')).toBe(2)
  })
})

describe('esReintentable (fallback de modelo)', () => {
  it('429 y 5xx reintentan; 4xx comunes no', () => {
    expect(esReintentable(429)).toBe(true)
    expect(esReintentable(500)).toBe(true)
    expect(esReintentable(503)).toBe(true)
    expect(esReintentable(400)).toBe(false)
    expect(esReintentable(401)).toBe(false)
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

  it('marca las secciones de módulos que el usuario NO ve (anti "andá a Inventario" a un CAJERO)', () => {
    const p = construirSystemPrompt(TODAS, ctx, 'cuánto stock tengo')
    // Inventario matchea por keyword pero no está en el menú del CAJERO → lleva el aviso
    const idx = p.indexOf('### Inventario')
    expect(idx).toBeGreaterThan(-1)
    // El aviso va en la línea inmediata al header de la sección
    expect(p.slice(idx).split('\n')[1]).toContain('NO ESTÁ EN EL MENÚ DE ESTE USUARIO')
    // Ventas SÍ está en su menú → sin aviso
    const idxV = p.indexOf('### Ventas / POS')
    expect(p.slice(idxV).split('\n')[1]).not.toContain('NO ESTÁ EN EL MENÚ')
  })

  it('sin contexto: fallback que instruye a NO asumir el menú', () => {
    const p = construirSystemPrompt(TODAS, undefined, 'hola')
    expect(p).toContain('No se recibió el contexto')
    expect(p).not.toContain('Su menú lateral')
  })

  // G5 plan IA, Fase 1 (memoria conversacional de corto plazo) — reforzar "preguntar, no asumir"
  it('incluye la regla de preguntar antes de asumir ante un pedido ambiguo', () => {
    const p = construirSystemPrompt(TODAS, ctx, 'hola')
    expect(p).toContain('PREGUNTÁ ANTES DE ASUMIR')
  })

  // G5 plan IA, Fase 2 (wiring) — la sección de campos proponibles solo aparece para quien
  // realmente puede confirmarlos (la RPC exige DUEÑO/ADMIN, mig 376)
  it('lista los campos proponibles solo para DUEÑO/ADMIN, nunca para un CAJERO', () => {
    const pCajero = construirSystemPrompt(TODAS, ctx, 'hola') // ctx.rol === 'CAJERO'
    expect(pCajero).not.toContain('CAMPOS DE CONFIGURACIÓN QUE PODÉS PROPONER')

    const pDueno = construirSystemPrompt(TODAS, { ...ctx, rol: 'DUEÑO' }, 'hola')
    expect(pDueno).toContain('CAMPOS DE CONFIGURACIÓN QUE PODÉS PROPONER')
    expect(pDueno).toContain('pedido_manual_habilitado')

    const pAdmin = construirSystemPrompt(TODAS, { ...ctx, rol: 'ADMIN' }, 'hola')
    expect(pAdmin).toContain('CAMPOS DE CONFIGURACIÓN QUE PODÉS PROPONER')
  })
})

describe('construirToolPropuestaConfig', () => {
  it('enumera exactamente los campos del allowlist, ni uno más', () => {
    const tool = construirToolPropuestaConfig()
    const enumCampos = (tool.function.parameters.properties.campo as any).enum
    expect(enumCampos).toEqual(CONFIG_CAMPOS_IA.map(c => c.campo))
  })
})

describe('validarPropuestaConfig', () => {
  it('acepta un booleano válido', () => {
    const r = validarPropuestaConfig({ campo: 'pedido_manual_habilitado', valor_propuesto: true, razon: 'el usuario lo pidió' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toBe(true)
  })

  it('rechaza un campo fuera del allowlist (ej. uno fiscal)', () => {
    const r = validarPropuestaConfig({ campo: 'cuit', valor_propuesto: '20111111112', razon: 'x' })
    expect(r.ok).toBe(false)
  })

  it('rechaza sin razón', () => {
    const r = validarPropuestaConfig({ campo: 'pedido_manual_habilitado', valor_propuesto: true, razon: '' })
    expect(r.ok).toBe(false)
  })

  it('normaliza un booleano que llega como string ("true"/"false")', () => {
    const r = validarPropuestaConfig({ campo: 'pedido_cierre_automatico', valor_propuesto: 'false', razon: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toBe(false)
  })

  it('rechaza un entero fuera de los valores válidos (dominio del CHECK real)', () => {
    const r = validarPropuestaConfig({ campo: 'repositor_etiquetas_por_hoja', valor_propuesto: 7, razon: 'x' })
    expect(r.ok).toBe(false)
  })

  it('acepta un entero dentro del dominio', () => {
    const r = validarPropuestaConfig({ campo: 'repositor_etiquetas_por_hoja', valor_propuesto: 6, razon: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toBe(6)
  })

  it('rechaza un texto fuera de los valores válidos', () => {
    const r = validarPropuestaConfig({ campo: 'pedido_numeracion', valor_propuesto: 'otra_cosa', razon: 'x' })
    expect(r.ok).toBe(false)
  })

  it('acepta un texto dentro del dominio', () => {
    const r = validarPropuestaConfig({ campo: 'pedido_numeracion', valor_propuesto: 'sucursal', razon: 'x' })
    expect(r.ok).toBe(true)
  })
})
