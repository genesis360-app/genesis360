import { describe, it, expect } from 'vitest'
import { camposRequeridosCliente, enumLegacyDeCampos, validarClienteInline } from '@/lib/clienteCampos'

// Punto 4 backlog Fede/GO — campos requeridos del cliente en el POS (mig 280)

describe('camposRequeridosCliente', () => {
  it('jsonb nuevo manda', () => {
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: true, telefono: true, email: false } }))
      .toEqual({ dni: true, telefono: true, email: false })
  })
  it('jsonb NULL → fallback al enum legacy', () => {
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'nombre_dni' }))
      .toEqual({ dni: true, telefono: false, email: false })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'todos' }))
      .toEqual({ dni: true, telefono: true, email: true })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'nombre' }))
      .toEqual({ dni: false, telefono: false, email: false })
  })
  it('tenant null / enum desconocido → nada requerido', () => {
    expect(camposRequeridosCliente(null)).toEqual({ dni: false, telefono: false, email: false })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'xxx' })).toEqual({ dni: false, telefono: false, email: false })
  })
  it('valores no-boolean en el jsonb no cuelan (solo true estricto)', () => {
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: 'yes', telefono: 1, email: null } }))
      .toEqual({ dni: false, telefono: false, email: false })
  })
})

describe('enumLegacyDeCampos (sincronización de la columna vieja)', () => {
  it('mapea al valor más cercano', () => {
    expect(enumLegacyDeCampos({ dni: true, telefono: true, email: true })).toBe('todos')
    expect(enumLegacyDeCampos({ dni: true, telefono: false, email: true })).toBe('nombre_dni_email')
    expect(enumLegacyDeCampos({ dni: true, telefono: false, email: false })).toBe('nombre_dni')
    expect(enumLegacyDeCampos({ dni: false, telefono: true, email: false })).toBe('nombre')  // sin equivalente exacto
  })
})

describe('validarClienteInline', () => {
  const req = { dni: true, telefono: false, email: true }
  it('nombre siempre obligatorio', () => {
    expect(validarClienteInline({ nombre: '', dni: '1', telefono: '', email: 'a@b.co' }, req)).toMatch(/nombre/i)
  })
  it('exige solo los campos marcados', () => {
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'a@b.co' }, req)).toMatch(/DNI/)
    expect(validarClienteInline({ nombre: 'Ana', dni: '1', telefono: '', email: '' }, req)).toMatch(/email/i)
    expect(validarClienteInline({ nombre: 'Ana', dni: '1', telefono: '', email: 'a@b.co' }, req)).toBeNull()
  })
  it('email con formato inválido se rechaza aunque no sea requerido', () => {
    const sinReq = { dni: false, telefono: false, email: false }
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'no-es-mail' }, sinReq)).toMatch(/válido/)
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: '' }, sinReq)).toBeNull()
  })
})
