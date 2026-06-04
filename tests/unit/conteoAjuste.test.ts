import { describe, it, expect } from 'vitest'
import { superaUmbral, requiereAutorizacion, requiereReconteo, reconciliarDelta } from '@/lib/conteoAjuste'

// Conteos 2.0 F3 — gate de ajustes, doble conteo, reconciliación por delta

describe('superaUmbral (combinado u/%/$)', () => {
  it('sin umbrales configurados → false', () => {
    expect(superaUmbral(100, 10, 99999, {})).toBe(false)
  })
  it('umbral en unidades: alcanza el borde', () => {
    expect(superaUmbral(5, 100, 0, { u: 5 })).toBe(true)
    expect(superaUmbral(4, 100, 0, { u: 5 })).toBe(false)
  })
  it('umbral en %: 3 sobre 100 esperadas = 3%', () => {
    expect(superaUmbral(3, 100, 0, { pct: 3 })).toBe(true)
    expect(superaUmbral(2, 100, 0, { pct: 3 })).toBe(false)
  })
  it('% no aplica si esperada 0 (evita div/0)', () => {
    expect(superaUmbral(5, 0, 0, { pct: 1 })).toBe(false)
  })
  it('umbral en valor $: óptica (1 unidad cara)', () => {
    expect(superaUmbral(1, 2, 50000, { valor: 30000 })).toBe(true)
    expect(superaUmbral(1, 2, 20000, { valor: 30000 })).toBe(false)
  })
  it('combinado: supera por cualquiera de los ejes', () => {
    // no supera u ni %, pero sí valor
    expect(superaUmbral(1, 100, 40000, { u: 10, pct: 50, valor: 30000 })).toBe(true)
  })
})

describe('requiereAutorizacion (gate D1)', () => {
  it('sin diferencia → nunca', () => {
    expect(requiereAutorizacion(false, 0, 100, 0, {})).toBe(false)
    expect(requiereAutorizacion(true, 0, 100, 0, { u: 1 })).toBe(false)
  })
  it('gate inactivo → todo ajuste con diferencia requiere autorización', () => {
    expect(requiereAutorizacion(false, 1, 100, 0, {})).toBe(true)
  })
  it('gate activo → solo si supera umbral', () => {
    expect(requiereAutorizacion(true, 2, 100, 0, { u: 5 })).toBe(false)
    expect(requiereAutorizacion(true, 6, 100, 0, { u: 5 })).toBe(true)
  })
})

describe('requiereReconteo (C1)', () => {
  it('sin diferencia → no', () => {
    expect(requiereReconteo(0, 100, 0, { u: 1 })).toBe(false)
  })
  it('supera umbral de reconteo → sí', () => {
    expect(requiereReconteo(10, 100, 0, { u: 5 })).toBe(true)
  })
  it('sin umbral configurado → no exige reconteo', () => {
    expect(requiereReconteo(10, 100, 0, {})).toBe(false)
  })
})

describe('reconciliarDelta (G1)', () => {
  it('sin movimientos intermedios (vivo == snapshot) → resultado = contado', () => {
    expect(reconciliarDelta(10, 7, 10)).toBe(7)
  })
  it('hubo ventas durante el conteo: respeta el delta, no pisa', () => {
    // snapshot 10, se vendieron 2 (vivo 8), conté 7 → delta -3 → 8-3 = 5
    expect(reconciliarDelta(8, 7, 10)).toBe(5)
  })
  it('nunca queda negativo', () => {
    expect(reconciliarDelta(1, 0, 10)).toBe(0)
  })
  it('ajuste positivo (sobrante)', () => {
    expect(reconciliarDelta(10, 13, 10)).toBe(13)
  })
})
