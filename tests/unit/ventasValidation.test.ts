import { describe, it, expect } from 'vitest'
import { validarMediosPago } from '@/lib/ventasValidation'

describe('Ventas — validación medios de pago', () => {
  const total = 1000

  describe('estado: pendiente', () => {
    it('permite sin medios de pago', () => {
      expect(validarMediosPago('pendiente', [{ tipo: '', monto: '' }], total)).toBeNull()
    })
    it('permite con efectivo mayor al total (vuelto)', () => {
      expect(validarMediosPago('pendiente', [{ tipo: 'Efectivo', monto: '1500' }], total)).toBeNull()
    })
    it('bloquea si monto excede total sin efectivo', () => {
      expect(validarMediosPago('pendiente', [{ tipo: 'Tarjeta débito', monto: '1500' }], total)).not.toBeNull()
    })
  })

  describe('estado: reservada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      expect(validarMediosPago('reservada', [{ tipo: '', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('bloquea con tipo sin monto', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('bloquea con monto sin tipo', () => {
      expect(validarMediosPago('reservada', [{ tipo: '', monto: '1000' }], total))
        .toBe('Ingresá un método de pago y monto para reservar')
    })
    it('permite con monto parcial (pago parcial OK en reserva)', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '500' }], total)).toBeNull()
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('permite con múltiples medios que suman el total', () => {
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: 'Tarjeta', monto: '400' }]
      expect(validarMediosPago('reservada', medios, total)).toBeNull()
    })
    it('bloquea si un medio tiene monto pero sin tipo (mixto sin tipo)', () => {
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: '', monto: '400' }]
      expect(validarMediosPago('reservada', medios, total))
        .toBe('Seleccioná un método de pago para todos los montos')
    })
  })

  describe('estado: despachada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      expect(validarMediosPago('despachada', [{ tipo: '', monto: '' }], total))
        .toBe('Ingresá un método de pago y monto para despachar')
    })
    it('bloquea con monto insuficiente', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '999' }], total))
        .toContain('Falta asignar')
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('permite con efectivo mayor al total (vuelto)', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1500' }], total)).toBeNull()
    })
    it('bloquea si monto excede total sin efectivo', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Tarjeta débito', monto: '1500' }], total))
        .toContain('excede el total')
    })
    it('bloquea si un medio tiene monto pero sin tipo (mixto sin tipo)', () => {
      // efectivo $600 cubre parcialmente, pero $400 sin tipo completa el total → debe bloquear
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: '', monto: '400' }]
      expect(validarMediosPago('despachada', medios, total))
        .toBe('Seleccioná un método de pago para todos los montos')
    })
  })
})
