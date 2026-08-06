import { describe, it, expect } from 'vitest'
import {
  parsearPildora, operadoresValidosParaCampo, operadorAjustado, formatearPildora,
  coincideValor, evaluarPildoras, type CampoDef,
} from '@/lib/pildorasFiltro'

type Campo = 'a' | 'b'
const CAMPOS: ReadonlyArray<CampoDef<Campo>> = [
  { campo: 'a', label: 'Alfa', aliases: ['alias-a'] },
  { campo: 'b', label: 'Beta', numerico: true },
]

describe('parsearPildora (genérico)', () => {
  it('reconoce "Campo:valor"', () => {
    expect(parsearPildora('Alfa:x', CAMPOS)).toMatchObject({ campo: 'a', operador: 'contiene', valor: 'x' })
  })

  it('resuelve por alias', () => {
    expect(parsearPildora('alias-a:x', CAMPOS)).toMatchObject({ campo: 'a' })
  })

  it('campo numérico acepta >, <, >=, <=', () => {
    expect(parsearPildora('b>=5', CAMPOS)).toMatchObject({ campo: 'b', operador: 'mayor_igual', valor: '5' })
  })

  it('campo desconocido → null', () => {
    expect(parsearPildora('zzz:1', CAMPOS)).toBeNull()
  })

  it('vacío → null', () => {
    expect(parsearPildora('', CAMPOS)).toBeNull()
  })
})

describe('operadoresValidosParaCampo / operadorAjustado', () => {
  it('campo de texto: solo contiene/no_contiene', () => {
    expect(operadoresValidosParaCampo('a', CAMPOS).map(o => o.operador)).toEqual(['contiene', 'no_contiene'])
  })

  it('campo numérico: los 6 operadores', () => {
    expect(operadoresValidosParaCampo('b', CAMPOS).map(o => o.operador)).toEqual(
      ['contiene', 'no_contiene', 'mayor', 'menor', 'mayor_igual', 'menor_igual'],
    )
  })

  it('clampa a "contiene" si el operador deja de ser válido al cambiar de campo', () => {
    expect(operadorAjustado('mayor', 'a', CAMPOS)).toBe('contiene')
    expect(operadorAjustado('mayor', 'b', CAMPOS)).toBe('mayor')
  })
})

describe('formatearPildora', () => {
  it('usa el label del campo', () => {
    expect(formatearPildora({ id: '1', campo: 'a', operador: 'contiene', valor: 'x' }, CAMPOS)).toBe('(Alfa):x')
  })

  it('libre se muestra sin paréntesis', () => {
    expect(formatearPildora({ id: '1', campo: 'libre', operador: 'contiene', valor: 'x' }, CAMPOS)).toBe('x')
  })
})

describe('coincideValor', () => {
  it('contiene / no_contiene son substring case-insensitive', () => {
    expect(coincideValor('Coca Cola', 'contiene', 'coca')).toBe(true)
    expect(coincideValor('Coca Cola', 'no_contiene', 'coca')).toBe(false)
  })

  it('operadores numéricos comparan el número, no substring', () => {
    expect(coincideValor(20, 'mayor', '10')).toBe(true)
    expect(coincideValor(20, 'mayor', '20')).toBe(false)
    expect(coincideValor(20, 'mayor_igual', '20')).toBe(true)
  })

  it('valor null nunca matchea un operador numérico', () => {
    expect(coincideValor(null, 'mayor', '1')).toBe(false)
  })

  it('valor buscado vacío matchea siempre (todavía se está tipeando)', () => {
    expect(coincideValor('cualquier cosa', 'contiene', '')).toBe(true)
  })
})

describe('evaluarPildoras (combinación Y/O genérica)', () => {
  const entidad = { x: 'coca', y: 20 }
  const evalUna = (e: typeof entidad, p: { campo: Campo | 'libre'; valor: string }) =>
    p.campo === 'a' ? e.x.includes(p.valor) : e.y === Number(p.valor)

  it('sin píldoras: todo pasa', () => {
    expect(evaluarPildoras(entidad, [], 'Y', evalUna)).toBe(true)
  })

  it('Y exige todas', () => {
    expect(evaluarPildoras(entidad, [
      { id: '1', campo: 'a', operador: 'contiene', valor: 'coca' },
      { id: '2', campo: 'b', operador: 'contiene', valor: '20' },
    ], 'Y', evalUna)).toBe(true)
    expect(evaluarPildoras(entidad, [
      { id: '1', campo: 'a', operador: 'contiene', valor: 'coca' },
      { id: '2', campo: 'b', operador: 'contiene', valor: '99' },
    ], 'Y', evalUna)).toBe(false)
  })

  it('O alcanza con una', () => {
    expect(evaluarPildoras(entidad, [
      { id: '1', campo: 'a', operador: 'contiene', valor: 'zzz' },
      { id: '2', campo: 'b', operador: 'contiene', valor: '20' },
    ], 'O', evalUna)).toBe(true)
  })
})
