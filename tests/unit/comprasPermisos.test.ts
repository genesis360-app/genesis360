import { describe, it, expect } from 'vitest'
import {
  capacidadCrearOC, ocRequiereAprobacion, puedeAprobarOC,
  puedeEnviarOC, puedeRegistrarPagoOC, requiereDobleFirmaPago,
  puedeCargarCotizacionCompras,
} from '@/lib/comprasPermisos'

// Compras CO1 — gobierno de OC (permisos + aprobación)

describe('capacidadCrearOC (A1)', () => {
  it('roles de gestión → completa', () => {
    for (const r of ['DUEÑO', 'ADMIN', 'SUPERVISOR', 'SUPER_USUARIO']) {
      expect(capacidadCrearOC(r)).toBe('completa')
    }
  })
  it('DEPOSITO → solo borrador', () => {
    expect(capacidadCrearOC('DEPOSITO')).toBe('borrador')
  })
  it('CAJERO / CONTADOR / null → ninguna', () => {
    expect(capacidadCrearOC('CAJERO')).toBe('ninguna')
    expect(capacidadCrearOC('CONTADOR')).toBe('ninguna')
    expect(capacidadCrearOC(null)).toBe('ninguna')
  })
})

describe('ocRequiereAprobacion (A2)', () => {
  it('gate inactivo → nunca requiere', () => {
    expect(ocRequiereAprobacion(999999, { activa: false, umbral: 1 })).toBe(false)
  })
  it('gate activo sin umbral → siempre requiere', () => {
    expect(ocRequiereAprobacion(1, { activa: true, umbral: null })).toBe(true)
    expect(ocRequiereAprobacion(1, { activa: true, umbral: 0 })).toBe(true)
  })
  it('gate activo con umbral → solo si lo supera (borde incluido)', () => {
    expect(ocRequiereAprobacion(10000, { activa: true, umbral: 10000 })).toBe(true)
    expect(ocRequiereAprobacion(9999, { activa: true, umbral: 10000 })).toBe(false)
  })
})

describe('puedeAprobarOC (A2)', () => {
  it('solo roles de gestión', () => {
    expect(puedeAprobarOC('DUEÑO')).toBe(true)
    expect(puedeAprobarOC('SUPERVISOR')).toBe(true)
    expect(puedeAprobarOC('DEPOSITO')).toBe(false)
    expect(puedeAprobarOC('CAJERO')).toBe(false)
  })
})

describe('puedeEnviarOC (A2)', () => {
  it('OC sin aprobación requerida → la envía cualquiera con capacidad completa', () => {
    expect(puedeEnviarOC('SUPERVISOR', { requiere_aprobacion: false })).toBe(true)
    expect(puedeEnviarOC('DEPOSITO', { requiere_aprobacion: false })).toBe(false)  // solo borrador
  })
  it('OC que requiere aprobación y NO aprobada → solo aprobador', () => {
    expect(puedeEnviarOC('DUEÑO', { requiere_aprobacion: true, aprobada_por: null })).toBe(true)
    expect(puedeEnviarOC('DEPOSITO', { requiere_aprobacion: true, aprobada_por: null })).toBe(false)
  })
  it('OC que requiere aprobación y YA aprobada → la envía cualquiera con capacidad completa', () => {
    expect(puedeEnviarOC('SUPERVISOR', { requiere_aprobacion: true, aprobada_por: 'u1' })).toBe(true)
  })
})

describe('puedeRegistrarPagoOC (D5)', () => {
  it('CONTADOR no puede (read-only)', () => {
    expect(puedeRegistrarPagoOC('CONTADOR')).toBe(false)
  })
  it('otros roles sí', () => {
    expect(puedeRegistrarPagoOC('DUEÑO')).toBe(true)
    expect(puedeRegistrarPagoOC('CAJERO')).toBe(true)
    expect(puedeRegistrarPagoOC(null)).toBe(false)
  })
})

describe('requiereDobleFirmaPago (D5)', () => {
  it('sin umbral → nunca', () => {
    expect(requiereDobleFirmaPago(999999, { umbral: null })).toBe(false)
    expect(requiereDobleFirmaPago(999999, { umbral: 0 })).toBe(false)
  })
  it('con umbral → solo si lo supera (borde incluido)', () => {
    expect(requiereDobleFirmaPago(50000, { umbral: 50000 })).toBe(true)
    expect(requiereDobleFirmaPago(49999, { umbral: 50000 })).toBe(false)
  })
})

// Compras/Gastos en USD (mig 380) — E1: quién puede cargar la cotización manual de una compra
describe('puedeCargarCotizacionCompras (E1, mig 380)', () => {
  it('DUEÑO siempre puede, sea cual sea la lista guardada', () => {
    expect(puedeCargarCotizacionCompras('DUEÑO', null, null)).toBe(true)
    expect(puedeCargarCotizacionCompras('DUEÑO', null, [])).toBe(true)
  })
  it('otros roles: NULL/[] (default) → nadie más que DUEÑO', () => {
    expect(puedeCargarCotizacionCompras('SUPERVISOR', null, null)).toBe(false)
    expect(puedeCargarCotizacionCompras('SUPERVISOR', null, [])).toBe(false)
  })
  it('rol base habilitado explícitamente en la lista → puede', () => {
    expect(puedeCargarCotizacionCompras('SUPERVISOR', null, ['SUPERVISOR'])).toBe(true)
    expect(puedeCargarCotizacionCompras('CAJERO', null, ['SUPERVISOR'])).toBe(false)
  })
  it('rol custom habilitado vía "custom:{id}" → puede', () => {
    expect(puedeCargarCotizacionCompras('CAJERO', 'rol-finanzas-123', ['custom:rol-finanzas-123'])).toBe(true)
    expect(puedeCargarCotizacionCompras('CAJERO', 'otro-rol', ['custom:rol-finanzas-123'])).toBe(false)
  })
})
