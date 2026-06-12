import { describe, it, expect } from 'vitest'
import {
  puedeCrearTraslado, puedeConfirmarRecepcion, disponibleLinea,
  validarCantidadTraslado, validarRecepcion, estadoDesdeRecepcion, totalFaltante,
} from '@/lib/trasladoLogic'

// Traslados entre sucursales (mig 205) — decisiones relevadas 2026-06-11:
// tránsito + confirmación · por LPN/línea · DEPOSITO+ crea, destino confirma · parcial auditado.

describe('puedeCrearTraslado', () => {
  it('DEPOSITO, SUPERVISOR, ADMIN, DUEÑO y SUPER_USUARIO pueden', () => {
    expect(puedeCrearTraslado('DEPOSITO')).toBe(true)
    expect(puedeCrearTraslado('SUPERVISOR')).toBe(true)
    expect(puedeCrearTraslado('ADMIN')).toBe(true)
    expect(puedeCrearTraslado('DUEÑO')).toBe(true)
    expect(puedeCrearTraslado('SUPER_USUARIO')).toBe(true)
  })
  it('CAJERO, CONTADOR, RRHH y null no pueden', () => {
    expect(puedeCrearTraslado('CAJERO')).toBe(false)
    expect(puedeCrearTraslado('CONTADOR')).toBe(false)
    expect(puedeCrearTraslado('RRHH')).toBe(false)
    expect(puedeCrearTraslado(null)).toBe(false)
  })
})

describe('puedeConfirmarRecepcion', () => {
  const base = { rol: 'DEPOSITO' as const, sucursalActivaId: 'suc-B', puedeVerTodas: false, sucursalDestinoId: 'suc-B' }
  it('usuario de la sucursal destino confirma', () => {
    expect(puedeConfirmarRecepcion(base)).toBe(true)
  })
  it('usuario parado en otra sucursal NO confirma', () => {
    expect(puedeConfirmarRecepcion({ ...base, sucursalActivaId: 'suc-A' })).toBe(false)
  })
  it('quien ve todas las sucursales (DUEÑO/habilitado) confirma desde cualquiera', () => {
    expect(puedeConfirmarRecepcion({ ...base, sucursalActivaId: 'suc-A', puedeVerTodas: true })).toBe(true)
  })
  it('rol sin inventario (CAJERO) no confirma aunque esté en destino', () => {
    expect(puedeConfirmarRecepcion({ ...base, rol: 'CAJERO' as any })).toBe(false)
  })
  it('rol null no confirma', () => {
    expect(puedeConfirmarRecepcion({ ...base, rol: null })).toBe(false)
  })
})

describe('disponibleLinea', () => {
  it('descuenta lo reservado', () => {
    expect(disponibleLinea(10, 3)).toBe(7)
  })
  it('sin reserva devuelve la cantidad', () => {
    expect(disponibleLinea(10, null)).toBe(10)
    expect(disponibleLinea(10)).toBe(10)
  })
  it('nunca negativo (sobre-reserva)', () => {
    expect(disponibleLinea(2, 5)).toBe(0)
  })
})

describe('validarCantidadTraslado', () => {
  it('cantidad válida → null', () => {
    expect(validarCantidadTraslado({ cantidad: 5, disponible: 10 })).toBeNull()
  })
  it('cantidad 0 o negativa → error', () => {
    expect(validarCantidadTraslado({ cantidad: 0, disponible: 10 })).toMatch(/válida/)
    expect(validarCantidadTraslado({ cantidad: -2, disponible: 10 })).toMatch(/válida/)
  })
  it('supera el disponible → error con el disponible', () => {
    expect(validarCantidadTraslado({ cantidad: 11, disponible: 10 })).toMatch(/10 disponible/)
  })
  it('decimal en producto de unidades enteras → error', () => {
    expect(validarCantidadTraslado({ cantidad: 1.5, disponible: 10 })).toMatch(/enteras/)
  })
  it('decimal permitido si esDecimal (kg, lt)', () => {
    expect(validarCantidadTraslado({ cantidad: 1.5, disponible: 10, esDecimal: true })).toBeNull()
  })
  it('borde: cantidad === disponible es válido', () => {
    expect(validarCantidadTraslado({ cantidad: 10, disponible: 10 })).toBeNull()
  })
})

describe('validarRecepcion / estadoDesdeRecepcion / totalFaltante', () => {
  it('recepción completa → válida, estado recibido, faltante 0', () => {
    const items = [{ cantidad: 5, cantidad_recibida: 5 }, { cantidad: 3, cantidad_recibida: 3 }]
    expect(validarRecepcion(items)).toBeNull()
    expect(estadoDesdeRecepcion(items)).toBe('recibido')
    expect(totalFaltante(items)).toBe(0)
  })
  it('recepción parcial → válida, estado recibido_parcial, faltante = diferencia', () => {
    const items = [{ cantidad: 5, cantidad_recibida: 4 }, { cantidad: 3, cantidad_recibida: 3 }]
    expect(validarRecepcion(items)).toBeNull()
    expect(estadoDesdeRecepcion(items)).toBe('recibido_parcial')
    expect(totalFaltante(items)).toBe(1)
  })
  it('recibir 0 de un ítem es válido (no llegó nada de ese LPN)', () => {
    const items = [{ cantidad: 5, cantidad_recibida: 0 }]
    expect(validarRecepcion(items)).toBeNull()
    expect(estadoDesdeRecepcion(items)).toBe('recibido_parcial')
    expect(totalFaltante(items)).toBe(5)
  })
  it('recibir más de lo despachado → error', () => {
    expect(validarRecepcion([{ cantidad: 5, cantidad_recibida: 6 }])).toMatch(/más de lo despachado/)
  })
  it('cantidad recibida negativa o inválida → error', () => {
    expect(validarRecepcion([{ cantidad: 5, cantidad_recibida: -1 }])).toMatch(/inválida/)
    expect(validarRecepcion([{ cantidad: 5, cantidad_recibida: NaN }])).toMatch(/inválida/)
  })
  it('sin ítems → error', () => {
    expect(validarRecepcion([])).toMatch(/no tiene ítems/)
  })
})
