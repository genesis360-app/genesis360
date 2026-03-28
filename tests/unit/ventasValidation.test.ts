import { describe, it, expect } from 'vitest'

// Lógica de validación de medios de pago extraída de VentasPage.registrarVenta()
// Si se cambia la lógica en VentasPage, actualizar también acá.

interface MedioPagoItem { tipo: string; monto: string }

function validarMediosPago(
  estado: 'pendiente' | 'reservada' | 'despachada',
  mediosPago: MedioPagoItem[],
  total: number
): string | null {
  const totalAsignado = mediosPago.reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0)
  const totalFaltante = total - totalAsignado
  const hayMontos = mediosPago.some(m => m.monto !== '')

  if (estado === 'reservada' || estado === 'despachada') {
    const tieneMetodoValido = mediosPago.some(m => m.tipo && parseFloat(m.monto) > 0)
    if (!tieneMetodoValido) return 'Ingresá un método de pago y monto para reservar o despachar'
    if (totalFaltante > 0.5) return `Falta asignar $${totalFaltante.toLocaleString('es-AR', { maximumFractionDigits: 0 })} en medios de pago`
  }
  if (hayMontos && totalFaltante < -0.5) return `El monto ingresado excede el total por $${Math.abs(totalFaltante).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  return null
}

describe('Ventas — validación medios de pago', () => {
  const total = 1000

  describe('estado: pendiente', () => {
    it('permite sin medios de pago', () => {
      expect(validarMediosPago('pendiente', [{ tipo: '', monto: '' }], total)).toBeNull()
    })
    it('permite con monto excedido (solo avisa si hay montos)', () => {
      expect(validarMediosPago('pendiente', [{ tipo: 'Efectivo', monto: '1500' }], total)).not.toBeNull()
    })
  })

  describe('estado: reservada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      const error = validarMediosPago('reservada', [{ tipo: '', monto: '' }], total)
      expect(error).toBe('Ingresá un método de pago y monto para reservar o despachar')
    })
    it('bloquea con tipo sin monto', () => {
      const error = validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '' }], total)
      expect(error).toBe('Ingresá un método de pago y monto para reservar o despachar')
    })
    it('bloquea con monto sin tipo', () => {
      const error = validarMediosPago('reservada', [{ tipo: '', monto: '1000' }], total)
      expect(error).toBe('Ingresá un método de pago y monto para reservar o despachar')
    })
    it('bloquea con monto insuficiente', () => {
      const error = validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '500' }], total)
      expect(error).toContain('Falta asignar')
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('reservada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('permite con múltiples medios que suman el total', () => {
      const medios = [{ tipo: 'Efectivo', monto: '600' }, { tipo: 'Tarjeta', monto: '400' }]
      expect(validarMediosPago('reservada', medios, total)).toBeNull()
    })
  })

  describe('estado: despachada', () => {
    it('bloquea sin ningún medio de pago ingresado', () => {
      const error = validarMediosPago('despachada', [{ tipo: '', monto: '' }], total)
      expect(error).toBe('Ingresá un método de pago y monto para reservar o despachar')
    })
    it('bloquea con monto insuficiente', () => {
      const error = validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '999' }], total)
      expect(error).toContain('Falta asignar')
    })
    it('permite con monto exacto', () => {
      expect(validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1000' }], total)).toBeNull()
    })
    it('bloquea si monto excede total', () => {
      const error = validarMediosPago('despachada', [{ tipo: 'Efectivo', monto: '1500' }], total)
      expect(error).toContain('excede el total')
    })
  })
})
