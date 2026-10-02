import { describe, it, expect } from 'vitest'
import { camposRequeridosCliente, enumLegacyDeCampos, validarClienteInline, dniObligatorioEnFicha } from '@/lib/clienteCampos'

// Punto 4 backlog Fede/GO — campos requeridos del cliente en el POS (mig 280)

describe('camposRequeridosCliente', () => {
  it('jsonb nuevo manda', () => {
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: true, telefono: true, email: false } }))
      .toEqual({ dni: true, telefono: true, email: false, cuit: false })
  })
  it('jsonb NULL → fallback al enum legacy', () => {
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'nombre_dni' }))
      .toEqual({ dni: true, telefono: false, email: false, cuit: false })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'todos' }))
      .toEqual({ dni: true, telefono: true, email: true, cuit: false })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'nombre' }))
      .toEqual({ dni: false, telefono: false, email: false, cuit: false })
  })
  it('tenant null / enum desconocido → nada requerido', () => {
    expect(camposRequeridosCliente(null)).toEqual({ dni: false, telefono: false, email: false, cuit: false })
    expect(camposRequeridosCliente({ cliente_datos_minimos: 'xxx' })).toEqual({ dni: false, telefono: false, email: false, cuit: false })
  })
  it('valores no-boolean en el jsonb no cuelan (solo true estricto)', () => {
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: 'yes', telefono: 1, email: null } }))
      .toEqual({ dni: false, telefono: false, email: false, cuit: false })
  })
})

describe('enumLegacyDeCampos (sincronización de la columna vieja)', () => {
  it('mapea al valor más cercano', () => {
    expect(enumLegacyDeCampos({ dni: true, telefono: true, email: true, cuit: false })).toBe('todos')
    expect(enumLegacyDeCampos({ dni: true, telefono: false, email: true, cuit: false })).toBe('nombre_dni_email')
    expect(enumLegacyDeCampos({ dni: true, telefono: false, email: false, cuit: false })).toBe('nombre_dni')
    expect(enumLegacyDeCampos({ dni: false, telefono: true, email: false, cuit: false })).toBe('nombre')  // sin equivalente exacto
  })
})

describe('validarClienteInline', () => {
  const req = { dni: true, telefono: false, email: true, cuit: false }
  it('nombre siempre obligatorio', () => {
    expect(validarClienteInline({ nombre: '', dni: '1', telefono: '', email: 'a@b.co' }, req)).toMatch(/nombre/i)
  })
  it('exige solo los campos marcados', () => {
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'a@b.co' }, req)).toMatch(/DNI/)
    expect(validarClienteInline({ nombre: 'Ana', dni: '1', telefono: '', email: '' }, req)).toMatch(/email/i)
    expect(validarClienteInline({ nombre: 'Ana', dni: '1', telefono: '', email: 'a@b.co' }, req)).toBeNull()
  })
  it('email con formato inválido se rechaza aunque no sea requerido', () => {
    const sinReq = { dni: false, telefono: false, email: false, cuit: false }
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'no-es-mail' }, sinReq)).toMatch(/válido/)
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: '' }, sinReq)).toBeNull()
  })
  it('alta rápida con CUIT (empresa): el DNI deja de ser obligatorio, como en la ficha', () => {
    expect(validarClienteInline({ nombre: 'Ejemplo SRL', dni: '', telefono: '', email: 'a@b.co', cuit: '30-71234567-8' }, req)).toBeNull()
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'a@b.co', cuit: '' }, req)).toMatch(/DNI/)
    expect(validarClienteInline({ nombre: 'Ana', dni: '', telefono: '', email: 'a@b.co', cuit: '2012' }, req)).toMatch(/DNI/)
  })
})


describe('CUIT obligatorio (2026-10-01)', () => {
  const reqCuit = { dni: false, telefono: false, email: false, cuit: true }
  it('se lee del jsonb; sin la clave (config vieja) = no requerido', () => {
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: false, telefono: false, email: false, cuit: true } }).cuit).toBe(true)
    expect(camposRequeridosCliente({ cliente_campos_requeridos: { dni: true, telefono: false, email: false } }).cuit).toBe(false)
  })
  it('marcado: sin CUIT o incompleto se rechaza; con 11 dígitos (con o sin guiones) pasa', () => {
    expect(validarClienteInline({ nombre: 'Ejemplo SRL', dni: '', telefono: '', email: '', cuit: '' }, reqCuit)).toMatch(/CUIT/)
    expect(validarClienteInline({ nombre: 'Ejemplo SRL', dni: '', telefono: '', email: '', cuit: '30-7123' }, reqCuit)).toMatch(/CUIT/)
    expect(validarClienteInline({ nombre: 'Ejemplo SRL', dni: '', telefono: '', email: '', cuit: '30-71234567-8' }, reqCuit)).toBeNull()
  })
  it('CUIT y DNI marcados: con CUIT el DNI sigue sin exigirse', () => {
    const ambos = { dni: true, telefono: false, email: false, cuit: true }
    expect(validarClienteInline({ nombre: 'Ejemplo SRL', dni: '', telefono: '', email: '', cuit: '30-71234567-8' }, ambos)).toBeNull()
  })
})

describe('dniObligatorioEnFicha — con CUIT el DNI es opcional (una empresa no tiene DNI)', () => {
  it('sin CUIT o con CUIT incompleto → DNI obligatorio', () => {
    expect(dniObligatorioEnFicha('')).toBe(true)
    expect(dniObligatorioEnFicha(null)).toBe(true)
    expect(dniObligatorioEnFicha('30-1234')).toBe(true)
  })
  it('con CUIT de 11 dígitos (con o sin guiones) → DNI opcional', () => {
    expect(dniObligatorioEnFicha('30-70308853-4')).toBe(false)
    expect(dniObligatorioEnFicha('30703088534')).toBe(false)
  })
})
