import { describe, it, expect } from 'vitest'
import {
  resolverCondicionesCC, habilitadaAForm, habilitadaDesdeForm, propiosDesdeForm, tienePropios, propiosQueCompiten, num,
  type CondicionesCategoria, type CondicionesNegocio, type PropiosCliente,
} from '@/lib/ccCategorias'

// Espejo de `vw_clientes_cc` (mig 442). Los casos son los mismos que se probaron contra la vista en DEV.

const negocio: CondicionesNegocio = { limite_cc_default: null, cc_dias_vencimiento: 2, cc_interes_mensual_pct: '100.000', cc_enforcement_politica: 'bloquear' }
const sinPropios: PropiosCliente = { cuenta_corriente_habilitada: null, limite_credito: null, plazo_pago_dias: null }
const colocadores: CondicionesCategoria = {
  activo: true, cc_habilitada: true, cc_limite: '1000.00', cc_plazo_dias: 10, cc_interes_mensual_pct: '7.000', cc_enforcement_politica: 'bloquear',
}

describe('resolverCondicionesCC — Cliente > Categoría activa > Negocio (D1)', () => {
  it('sin categoría ni propios: lo del negocio (y NO habilitada)', () => {
    const r = resolverCondicionesCC(sinPropios, null, negocio)
    expect(r).toMatchObject({ cc_habilitada: false, cc_limite: null, cc_plazo_dias: 2, cc_interes_mensual_pct: 100, cc_enforcement_politica: 'bloquear' })
    expect(r.origen).toEqual({ habilitada: 'negocio', limite: 'negocio', plazo: 'negocio', interes: 'negocio', enforcement: 'negocio' })
  })
  it('negocio sin días configurados → 30 (decisión de GO)', () => {
    expect(resolverCondicionesCC(sinPropios, null, { ...negocio, cc_dias_vencimiento: null }).cc_plazo_dias).toBe(30)
  })
  it('sin propios hereda TODO de la categoría (numeric como string incluido)', () => {
    const r = resolverCondicionesCC(sinPropios, colocadores, negocio)
    expect(r).toMatchObject({ cc_habilitada: true, cc_limite: 1000, cc_plazo_dias: 10, cc_interes_mensual_pct: 7 })
    expect(r.origen.limite).toBe('categoria')
  })
  it('el valor propio gana a la categoría (D1)', () => {
    const r = resolverCondicionesCC({ cuenta_corriente_habilitada: null, limite_credito: '200000.00', plazo_pago_dias: null }, colocadores, negocio)
    expect(r.cc_limite).toBe(200000)
    expect(r.origen.limite).toBe('cliente')
    expect(r.cc_plazo_dias).toBe(10)
  })
  it('un "no" propio gana a un "sí" de la categoría', () => {
    expect(resolverCondicionesCC({ ...sinPropios, cuenta_corriente_habilitada: false }, colocadores, negocio).cc_habilitada).toBe(false)
  })
  it('categoría DESACTIVADA no aplica: vuelve a lo del negocio (C2)', () => {
    const r = resolverCondicionesCC(sinPropios, { ...colocadores, activo: false }, negocio)
    expect(r.cc_limite).toBeNull()
    expect(r.origen.limite).toBe('negocio')
    expect(r.cc_habilitada).toBe(false)
  })
  it('una condición de la categoría en null hereda del negocio (D4: cada parte opcional)', () => {
    const r = resolverCondicionesCC(sinPropios, { ...colocadores, cc_interes_mensual_pct: null, cc_enforcement_politica: null }, negocio)
    expect(r.cc_interes_mensual_pct).toBe(100)
    expect(r.cc_enforcement_politica).toBe('bloquear')
    expect(r.origen.interes).toBe('negocio')
  })
  it('🛑 interés 0 explícito en la categoría NO es "hereda" (un || lo convertiría en el del negocio)', () => {
    const r = resolverCondicionesCC(sinPropios, { ...colocadores, cc_interes_mensual_pct: '0.000' }, negocio)
    expect(r.cc_interes_mensual_pct).toBe(0)
    expect(r.origen.interes).toBe('categoria')
  })
  it('🛑 límite 0 propio es "sin crédito", no "hereda"', () => {
    const r = resolverCondicionesCC({ ...sinPropios, limite_credito: '0.00' }, colocadores, negocio)
    expect(r.cc_limite).toBe(0)
    expect(r.origen.limite).toBe('cliente')
  })
})

describe('formulario de 3 estados', () => {
  it('habilitada: null ↔ hereda, true ↔ si, false ↔ no', () => {
    expect(habilitadaAForm(null)).toBe('hereda'); expect(habilitadaAForm(undefined)).toBe('hereda')
    expect(habilitadaAForm(true)).toBe('si'); expect(habilitadaAForm(false)).toBe('no')
    expect(habilitadaDesdeForm('hereda')).toBeNull(); expect(habilitadaDesdeForm('si')).toBe(true); expect(habilitadaDesdeForm('no')).toBe(false)
  })
  it('vacío = hereda; coma decimal; plazo entero', () => {
    expect(propiosDesdeForm({ cc_habilitada: 'hereda', limite_credito: '', plazo_pago_dias: '' })).toEqual(sinPropios)
    expect(propiosDesdeForm({ cc_habilitada: 'si', limite_credito: '1500,5', plazo_pago_dias: '15' }))
      .toEqual({ cuenta_corriente_habilitada: true, limite_credito: 1500.5, plazo_pago_dias: 15 })
    expect(propiosDesdeForm({ cc_habilitada: 'no', limite_credito: '0', plazo_pago_dias: '' }).limite_credito).toBe(0)
  })
  it('tienePropios', () => {
    expect(tienePropios(sinPropios)).toBe(false)
    expect(tienePropios({ ...sinPropios, limite_credito: '0' })).toBe(true)
    expect(tienePropios({ ...sinPropios, cuenta_corriente_habilitada: false })).toBe(true)
  })
  it('num: string numérico, vacío y basura', () => {
    expect(num('21.00')).toBe(21); expect(num('')).toBeNull(); expect(num('abc')).toBeNull(); expect(num(0)).toBe(0)
  })
})

describe('propiosQueCompiten (D2: quiénes necesitan decisión en una asignación)', () => {
  it('solo los campos donde el propio DIFIERE de lo que define la categoría', () => {
    expect(propiosQueCompiten({ cuenta_corriente_habilitada: true, limite_credito: '500000', plazo_pago_dias: 10 }, colocadores))
      .toEqual([{ campo: 'limite', propio: '500000', categoria: '1000' }])
  })
  it('si la categoría no define el campo, el propio no compite', () => {
    expect(propiosQueCompiten({ ...sinPropios, limite_credito: 5 }, { ...colocadores, cc_limite: null })).toEqual([])
  })
  it('sin propios → nada que decidir', () => {
    expect(propiosQueCompiten(sinPropios, colocadores)).toEqual([])
  })
})
