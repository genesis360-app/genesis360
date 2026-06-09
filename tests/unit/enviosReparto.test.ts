import { describe, it, expect } from 'vitest'
import {
  productividadRepartidor, cumplimientoDia, ordenarHojaRuta, tokenExpiraAt,
  type EnvioReparto,
} from '@/lib/enviosReparto'

// Envíos EN3 — reparto

const e = (id: string, repartidor: string | null, estado: string, extra: Partial<EnvioReparto> = {}): EnvioReparto =>
  ({ id, repartidor_id: repartidor, estado, ...extra })

describe('productividadRepartidor (G1)', () => {
  it('agrupa por repartidor con cumplimiento %', () => {
    const r = productividadRepartidor([
      e('1', 'r1', 'entregado'), e('2', 'r1', 'entregado'), e('3', 'r1', 'en_camino'),
      e('4', 'r2', 'devolucion'),
    ])
    const r1 = r.find(x => x.repartidorId === 'r1')!
    expect(r1).toMatchObject({ asignados: 3, entregados: 2, pendientes: 1, pctCumplimiento: 67 })
    const r2 = r.find(x => x.repartidorId === 'r2')!
    expect(r2).toMatchObject({ asignados: 1, devueltos: 1, pctCumplimiento: 0 })
  })
})

describe('cumplimientoDia (G3)', () => {
  it('calcula entregados/pendientes/% sobre el total', () => {
    const c = cumplimientoDia([
      e('1', 'r1', 'entregado'), e('2', 'r1', 'en_camino'),
      e('3', 'r1', 'entregado'), e('4', 'r1', 'cancelado'),
    ])
    expect(c).toEqual({ total: 4, entregados: 2, pendientes: 1, pct: 50 })
  })
  it('lista vacía → 0%', () => {
    expect(cumplimientoDia([]).pct).toBe(0)
  })
})

describe('ordenarHojaRuta (G3/E3)', () => {
  it('sin coords ordena por zona y hora', () => {
    const r = ordenarHojaRuta([
      e('1', 'r1', 'en_camino', { zona_entrega: 'Norte', hora_entrega_acordada: '15:00' }),
      e('2', 'r1', 'en_camino', { zona_entrega: 'Centro', hora_entrega_acordada: '10:00' }),
      e('3', 'r1', 'en_camino', { zona_entrega: 'Centro', hora_entrega_acordada: '09:00' }),
    ])
    expect(r.map(x => x.id)).toEqual(['3', '2', '1'])
  })
  it('con coords y proximidad usa vecino más cercano desde el origen', () => {
    const origen = { lat: -34.60, lon: -58.38 }
    const r = ordenarHojaRuta([
      e('lejos', 'r1', 'en_camino', { lat: -34.70, lon: -58.50 }),
      e('cerca', 'r1', 'en_camino', { lat: -34.61, lon: -58.39 }),
      e('medio', 'r1', 'en_camino', { lat: -34.65, lon: -58.45 }),
    ], { proximidad: true, origen })
    expect(r[0].id).toBe('cerca')
    expect(r[r.length - 1].id).toBe('lejos')
  })
  it('proximidad sin origen cae al orden estable', () => {
    const r = ordenarHojaRuta([
      e('1', 'r1', 'en_camino', { zona_entrega: 'B', lat: -34.6, lon: -58.3 }),
      e('2', 'r1', 'en_camino', { zona_entrega: 'A', lat: -34.6, lon: -58.4 }),
    ], { proximidad: true, origen: null })
    expect(r.map(x => x.id)).toEqual(['2', '1'])
  })
})

describe('tokenExpiraAt (E1)', () => {
  it('política días → ahora + N días', () => {
    const ahora = new Date('2026-06-08T12:00:00Z')
    const r = tokenExpiraAt('dias', 30, ahora)
    expect(r).toBe(new Date('2026-07-08T12:00:00Z').toISOString())
  })
  it('al_entregar → null', () => {
    expect(tokenExpiraAt('al_entregar', 30)).toBeNull()
  })
})
