import { describe, it, expect } from 'vitest'
import { urgenciaEntrega, ordenarPorEntrega, fechaEntregaLegible } from '@/lib/pedidoPrioridad'

describe('urgenciaEntrega', () => {
  const hoy = '2026-10-02'
  it('atrasado / hoy / mañana / próximo según el día local', () => {
    expect(urgenciaEntrega('2026-10-01', 'confirmado', hoy)).toBe('atrasado')
    expect(urgenciaEntrega('2026-10-02', 'en_preparacion', hoy)).toBe('hoy')
    expect(urgenciaEntrega('2026-10-03', 'confirmado', hoy)).toBe('manana')
    expect(urgenciaEntrega('2026-10-09', 'confirmado', hoy)).toBe('proximo')
  })
  it('mañana cruzando fin de mes', () => {
    expect(urgenciaEntrega('2026-11-01', 'confirmado', '2026-10-31')).toBe('manana')
  })
  it('sin fecha o pedido cerrado → null', () => {
    expect(urgenciaEntrega(null, 'confirmado', hoy)).toBeNull()
    expect(urgenciaEntrega('2026-09-01', 'entregado', hoy)).toBeNull()
    expect(urgenciaEntrega('2026-09-01', 'cancelado', hoy)).toBeNull()
  })
})

describe('ordenarPorEntrega', () => {
  it('con fecha (más cercana primero) → sin fecha → cerrados; desempate por más nuevo', () => {
    const ps = [
      { id: 'sinFecha', fecha_entrega_solicitada: null, estado: 'confirmado', created_at: '2026-10-02T10:00:00Z' },
      { id: 'entregado', fecha_entrega_solicitada: '2026-09-01', estado: 'entregado', created_at: '2026-09-01T10:00:00Z' },
      { id: 'el5', fecha_entrega_solicitada: '2026-10-05', estado: 'confirmado', created_at: '2026-10-01T10:00:00Z' },
      { id: 'atrasado', fecha_entrega_solicitada: '2026-09-30', estado: 'en_preparacion', created_at: '2026-09-29T10:00:00Z' },
      { id: 'el5nuevo', fecha_entrega_solicitada: '2026-10-05', estado: 'confirmado', created_at: '2026-10-02T09:00:00Z' },
    ]
    expect(ordenarPorEntrega(ps).map(p => p.id)).toEqual(['atrasado', 'el5nuevo', 'el5', 'sinFecha', 'entregado'])
  })
})

describe('fechaEntregaLegible', () => {
  it('no corre la fecha un día (UTC vs Argentina)', () => {
    expect(fechaEntregaLegible('2026-10-05')).toBe(new Date(2026, 9, 5).toLocaleDateString('es-AR'))
  })
})
