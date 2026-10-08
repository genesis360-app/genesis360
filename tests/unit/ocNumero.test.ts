import { describe, it, expect, afterEach } from 'vitest'
import { etiquetaOC, nombreOC, ocCoincideNumero, registrarCodigosSucursal } from '@/lib/ocNumero'

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

// GO 07/10: con "S-OC" fijo, dos sucursales mostraban "S-OC-0001" para OCs distintas → "OC-<código>-0001".
describe('etiqueta con el código de la sucursal', () => {
  afterEach(() => registrarCodigosSucursal([]))
  const centro = { numero: 84, numero_sucursal: 1, sucursal_id: 'suc-centro' }
  const norte = { numero: 85, numero_sucursal: 1, sucursal_id: 'suc-norte' }

  it('dos sucursales con código → etiquetas distintas para el mismo correlativo', () => {
    registrarCodigosSucursal([{ id: 'suc-centro', codigo: 'CEN' }, { id: 'suc-norte', codigo: ' NOR ' }])
    expect(etiquetaOC(centro)).toBe('OC-CEN-0001')
    expect(etiquetaOC(norte)).toBe('OC-NOR-0001')
    expect(nombreOC(norte)).toBe('OC OC-NOR-0001')
  })
  it('sucursal sin código (o sin sucursal) → sigue "S-OC-0001", como hasta hoy', () => {
    registrarCodigosSucursal([{ id: 'suc-centro', codigo: '' }, { id: 'suc-norte', codigo: null }])
    expect(etiquetaOC(centro)).toBe('S-OC-0001')
    expect(etiquetaOC({ numero: 9, numero_sucursal: 3 })).toBe('S-OC-0003')
  })
  it('numeración del negocio no usa el código', () => {
    registrarCodigosSucursal([{ id: 'suc-centro', codigo: 'CEN' }])
    expect(etiquetaOC(centro, 'tenant')).toBe('#84')
  })
  it('la búsqueda "OC-CEN-0001" encuentra solo la OC de esa sucursal', () => {
    registrarCodigosSucursal([{ id: 'suc-centro', codigo: 'CEN' }, { id: 'suc-norte', codigo: 'NOR' }])
    expect(ocCoincideNumero(centro, 'oc-cen-0001')).toBe(true)
    expect(ocCoincideNumero(norte, 'OC-CEN-0001')).toBe(false)
    expect(ocCoincideNumero(centro, 'OC-CEN-2')).toBe(false)
    expect(ocCoincideNumero(centro, 'S-OC-0001')).toBe(true)   // la forma vieja sigue encontrando
  })
})
