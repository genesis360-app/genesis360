import { describe, it, expect } from 'vitest'
import {
  sugerirCourierPorCp, clasificarCanal, plazoDespachoVencido, unidadesEnviadas,
} from '@/lib/enviosCreacion'

// Envíos EN5 — creación y alcance

describe('sugerirCourierPorCp (A3)', () => {
  it('match exacto de CP', () => {
    expect(sugerirCourierPorCp('1407', [{ cp: '1407', courier: 'OCA' }])).toBe('OCA')
  })
  it('match por rango', () => {
    const m = [{ desde: '1000', hasta: '1499', courier: 'Andreani' }]
    expect(sugerirCourierPorCp('1407', m)).toBe('Andreani')
    expect(sugerirCourierPorCp('1600', m)).toBeNull()
  })
  it('primer match gana', () => {
    const m = [{ cp: '1407', courier: 'OCA' }, { desde: '1000', hasta: '1999', courier: 'Andreani' }]
    expect(sugerirCourierPorCp('1407', m)).toBe('OCA')
  })
  it('sin CP o sin mapping → null', () => {
    expect(sugerirCourierPorCp('', [{ cp: '1407', courier: 'OCA' }])).toBeNull()
    expect(sugerirCourierPorCp('1407', null)).toBeNull()
  })
})

describe('clasificarCanal (A4)', () => {
  it('POS / presencial', () => {
    expect(clasificarCanal('POS')).toBe('presencial')
    expect(clasificarCanal('Mostrador')).toBe('presencial')
  })
  it('online por defecto', () => {
    expect(clasificarCanal('MELI')).toBe('online')
    expect(clasificarCanal('TiendaNube')).toBe('online')
  })
  it('mayorista', () => {
    expect(clasificarCanal('Venta Mayorista')).toBe('mayorista')
  })
})

describe('plazoDespachoVencido (A4)', () => {
  const ahora = new Date('2026-06-08T12:00:00Z')
  it('pendiente y pasó el límite → vencido', () => {
    const r = plazoDespachoVencido({ createdAt: '2026-06-05T12:00:00Z', estado: 'pendiente', canal: 'MELI', plazos: { online: 48 }, ahora })
    expect(r.vencido).toBe(true)
    expect(r.horasLimite).toBe(48)
  })
  it('dentro del plazo → no vencido', () => {
    const r = plazoDespachoVencido({ createdAt: '2026-06-08T06:00:00Z', estado: 'pendiente', canal: 'MELI', plazos: { online: 48 }, ahora })
    expect(r.vencido).toBe(false)
  })
  it('ya despachado → nunca vencido', () => {
    const r = plazoDespachoVencido({ createdAt: '2026-01-01T00:00:00Z', estado: 'despachado', canal: 'POS', plazos: { presencial: 24 }, ahora })
    expect(r.vencido).toBe(false)
  })
  it('sin plazo configurado → no vencido', () => {
    const r = plazoDespachoVencido({ createdAt: '2026-01-01T00:00:00Z', estado: 'pendiente', canal: 'POS', plazos: {}, ahora })
    expect(r.vencido).toBe(false)
  })
})

describe('unidadesEnviadas (A5)', () => {
  it('suma cantidades de los items del envío', () => {
    expect(unidadesEnviadas([{ cantidad: 2 }, { cantidad: 3 }, { cantidad: null }])).toBe(5)
  })
})
