import { describe, it, expect } from 'vitest'
import { clasificarABC, sugerirConteoCiclico, reporteExactitud, PARETO_A, PARETO_B } from '@/lib/conteoAbc'

// Conteos 2.0 F4 — clase ABC (Pareto), conteo cíclico sugerido, exactitud/valorización

describe('clasificarABC (Pareto 80/95)', () => {
  it('todos sin movimiento → todos C', () => {
    const m = clasificarABC([{ id: 'a', valor: 0 }, { id: 'b', valor: 0 }])
    expect(m.get('a')).toBe('C')
    expect(m.get('b')).toBe('C')
  })

  it('producto sin movimiento queda C aunque otros sí muevan', () => {
    const m = clasificarABC([{ id: 'top', valor: 1000 }, { id: 'sin', valor: 0 }])
    expect(m.get('sin')).toBe('C')
  })

  it('clasificación Pareto: el grueso del valor es A', () => {
    // 1 producto con 80% del valor, varios chicos
    const items = [
      { id: 'big', valor: 800 },
      { id: 'm1', valor: 80 },
      { id: 'm2', valor: 70 },
      { id: 's1', valor: 30 },
      { id: 's2', valor: 20 },
    ]
    const m = clasificarABC(items)
    expect(m.get('big')).toBe('A')           // 800/1000 = 80% acum → A
    expect(m.get('m1')).toBe('B')            // 880/1000 = 88% → B
    expect(m.get('m2')).toBe('B')            // 950/1000 = 95% → B (borde)
    expect(m.get('s1')).toBe('C')            // 980/1000 = 98% → C
    expect(m.get('s2')).toBe('C')            // 100% → C
  })

  it('devuelve clase para TODOS los items recibidos', () => {
    const items = [{ id: 'a', valor: 5 }, { id: 'b', valor: 3 }, { id: 'c', valor: 1 }]
    const m = clasificarABC(items)
    expect(m.size).toBe(3)
  })

  it('orden determinista ante empate de valor (por id)', () => {
    const m1 = clasificarABC([{ id: 'x', valor: 10 }, { id: 'y', valor: 10 }])
    const m2 = clasificarABC([{ id: 'y', valor: 10 }, { id: 'x', valor: 10 }])
    expect(m1.get('x')).toBe(m2.get('x'))
    expect(m1.get('y')).toBe(m2.get('y'))
  })

  it('constantes Pareto expuestas', () => {
    expect(PARETO_A).toBe(0.80)
    expect(PARETO_B).toBe(0.95)
  })
})

describe('sugerirConteoCiclico', () => {
  const cfg = { diasA: 30, diasB: 90, diasC: 180 }
  const hoy = new Date('2026-06-05T00:00:00Z')
  const haceDias = (n: number) => new Date(hoy.getTime() - n * 86_400_000).toISOString()

  it('producto A contado hace 40 días está vencido (ciclo 30)', () => {
    const r = sugerirConteoCiclico([{ id: 'a', clase_abc: 'A', ultimo_conteo_at: haceDias(40) }], cfg, hoy)
    expect(r).toHaveLength(1)
    expect(r[0].atraso).toBe(10)
  })

  it('producto A contado hace 10 días NO está vencido', () => {
    const r = sugerirConteoCiclico([{ id: 'a', clase_abc: 'A', ultimo_conteo_at: haceDias(10) }], cfg, hoy)
    expect(r).toHaveLength(0)
  })

  it('nunca contado → atraso Infinity, va primero', () => {
    const r = sugerirConteoCiclico([
      { id: 'viejo', clase_abc: 'A', ultimo_conteo_at: haceDias(100) },
      { id: 'nunca', clase_abc: 'C', ultimo_conteo_at: null },
    ], cfg, hoy)
    expect(r[0].id).toBe('nunca')
    expect(r[0].atraso).toBe(Infinity)
  })

  it('sin clase se trata como C (ciclo 180)', () => {
    const r = sugerirConteoCiclico([{ id: 'p', clase_abc: null, ultimo_conteo_at: haceDias(100) }], cfg, hoy)
    expect(r).toHaveLength(0)  // 100 < 180 → no vencido
  })

  it('ordena por mayor atraso primero', () => {
    const r = sugerirConteoCiclico([
      { id: 'poco', clase_abc: 'A', ultimo_conteo_at: haceDias(35) },   // atraso 5
      { id: 'mucho', clase_abc: 'A', ultimo_conteo_at: haceDias(60) },  // atraso 30
    ], cfg, hoy)
    expect(r.map(x => x.id)).toEqual(['mucho', 'poco'])
  })
})

describe('reporteExactitud', () => {
  it('conteo perfecto → 100% exactitud, sin valor', () => {
    const r = reporteExactitud([
      { cantidad_esperada: 10, cantidad_contada: 10, costo: 5 },
      { cantidad_esperada: 3, cantidad_contada: 3, costo: 2 },
    ])
    expect(r.exactitudPct).toBe(100)
    expect(r.lineasExactas).toBe(2)
    expect(r.valorNeto).toBe(0)
  })

  it('sobrante y faltante valorizados', () => {
    const r = reporteExactitud([
      { cantidad_esperada: 10, cantidad_contada: 12, costo: 100 }, // +2 → sobrante 200
      { cantidad_esperada: 5, cantidad_contada: 3, costo: 50 },    // -2 → faltante 100
    ])
    expect(r.valorSobrante).toBe(200)
    expect(r.valorFaltante).toBe(100)
    expect(r.valorNeto).toBe(100)
    expect(r.unidadesNetas).toBe(0)
    expect(r.lineasConDiff).toBe(2)
    expect(r.exactitudPct).toBe(0)
  })

  it('líneas no contadas (null) no entran en la exactitud', () => {
    const r = reporteExactitud([
      { cantidad_esperada: 10, cantidad_contada: 10, costo: 5 }, // exacta
      { cantidad_esperada: 4, cantidad_contada: null, costo: 5 }, // no contada
    ])
    expect(r.lineasContadas).toBe(1)
    expect(r.lineasSinContar).toBe(1)
    expect(r.exactitudPct).toBe(100)  // 1/1 contadas exactas
  })

  it('exactitud parcial: 1 de 2 contadas con diferencia', () => {
    const r = reporteExactitud([
      { cantidad_esperada: 10, cantidad_contada: 10, costo: 1 },
      { cantidad_esperada: 10, cantidad_contada: 9, costo: 1 },
    ])
    expect(r.exactitudPct).toBe(50)
  })

  it('sin líneas contadas → 0% (evita div/0)', () => {
    const r = reporteExactitud([{ cantidad_esperada: 5, cantidad_contada: null, costo: 1 }])
    expect(r.exactitudPct).toBe(0)
    expect(r.lineasContadas).toBe(0)
  })
})
