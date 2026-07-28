import { describe, it, expect } from 'vitest'
import { puedeTransicionPedido } from '@/lib/pedidoTransiciones'

describe('pedidoTransiciones — puedeTransicionPedido (defaults)', () => {
  it('DUEÑO/SUPERVISOR/SUPER_USUARIO/DEPOSITO pueden cualquier transición sin config', () => {
    expect(puedeTransicionPedido('DUEÑO', 'cancelar', null)).toBe(true)
    expect(puedeTransicionPedido('SUPERVISOR', 'lanzar', undefined)).toBe(true)
    expect(puedeTransicionPedido('SUPER_USUARIO', 'entregar', {})).toBe(true)
    expect(puedeTransicionPedido('DEPOSITO', 'confirmar', {})).toBe(true)
    expect(puedeTransicionPedido('DEPOSITO', 'deslanzar', {})).toBe(true)
  })
  it('CAJERO/RRHH/CONTADOR NO pueden por default', () => {
    expect(puedeTransicionPedido('CAJERO', 'cancelar', null)).toBe(false)
    expect(puedeTransicionPedido('RRHH', 'lanzar', undefined)).toBe(false)
    expect(puedeTransicionPedido('CONTADOR', 'entregar', {})).toBe(false)
  })
  it('sin rol → false', () => {
    expect(puedeTransicionPedido(null, 'cancelar', null)).toBe(false)
    expect(puedeTransicionPedido(undefined, 'cancelar', null)).toBe(false)
  })
  it('ADMIN (staff cross-tenant) siempre puede, incluso si la config lo excluye', () => {
    expect(puedeTransicionPedido('ADMIN', 'cancelar', { cancelar: ['DUEÑO'] })).toBe(true)
  })
})

describe('pedidoTransiciones — puedeTransicionPedido (config explícita)', () => {
  it('transición configurada reemplaza el default por completo (allow-list estricta)', () => {
    const cfg = { cancelar: ['DUEÑO'] }
    expect(puedeTransicionPedido('DUEÑO', 'cancelar', cfg)).toBe(true)
    expect(puedeTransicionPedido('SUPERVISOR', 'cancelar', cfg)).toBe(false)
    expect(puedeTransicionPedido('DEPOSITO', 'cancelar', cfg)).toBe(false)
  })
  it('array vacío bloquea la transición para todos salvo ADMIN', () => {
    const cfg = { entregar: [] as string[] }
    expect(puedeTransicionPedido('DUEÑO', 'entregar', cfg)).toBe(false)
    expect(puedeTransicionPedido('ADMIN', 'entregar', cfg)).toBe(true)
  })
  it('config puede sumar un rol que no está en el default (ej. CAJERO puede entregar)', () => {
    const cfg = { entregar: ['DUEÑO', 'SUPERVISOR', 'SUPER_USUARIO', 'DEPOSITO', 'CAJERO'] }
    expect(puedeTransicionPedido('CAJERO', 'entregar', cfg)).toBe(true)
  })
  it('transiciones NO configuradas siguen usando el default aunque otras sí estén configuradas', () => {
    const cfg = { cancelar: ['DUEÑO'] }
    expect(puedeTransicionPedido('DEPOSITO', 'lanzar', cfg)).toBe(true)
  })
})
