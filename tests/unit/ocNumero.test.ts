import { describe, it, expect } from 'vitest'
import { etiquetaOC, nombreOC, ocCoincideNumero } from '@/lib/ocNumero'

// GO 06/10: Proveedores mostraba "S-OC-0070" y Gastos "OC #84" para la MISMA orden de compra.
const oc = { numero: 84, numero_sucursal: 70 }

describe('número visible de una OC', () => {
  it('numeración por sucursal (default) → S-OC-0070, en todas las pantallas', () => {
    expect(etiquetaOC(oc)).toBe('S-OC-0070')
    expect(etiquetaOC(oc, 'sucursal')).toBe('S-OC-0070')
    expect(etiquetaOC(oc, null)).toBe('S-OC-0070')
    expect(nombreOC(oc, 'sucursal')).toBe('OC S-OC-0070')
  })
  it('numeración del negocio (o por proveedor) → #84', () => {
    expect(etiquetaOC(oc, 'tenant')).toBe('#84')
    expect(etiquetaOC(oc, 'proveedor')).toBe('#84')
    expect(nombreOC(oc, 'tenant')).toBe('OC #84')
  })
  it('sin número de sucursal cae al del negocio', () => {
    expect(etiquetaOC({ numero: 5, numero_sucursal: null }, 'sucursal')).toBe('#5')
    expect(etiquetaOC(null)).toBe('—')
  })
  it('la búsqueda encuentra la OC por cualquiera de sus dos números', () => {
    expect(ocCoincideNumero(oc, '84')).toBe(true)
    expect(ocCoincideNumero(oc, '70')).toBe(true)
    expect(ocCoincideNumero(oc, '0070')).toBe(true)
    expect(ocCoincideNumero(oc, 'S-OC-0070')).toBe(true)
    expect(ocCoincideNumero(oc, 's-oc-84')).toBe(false)   // pidió el de sucursal
    expect(ocCoincideNumero(oc, '7')).toBe(false)
    expect(ocCoincideNumero(oc, 'coca')).toBe(false)
  })
})
