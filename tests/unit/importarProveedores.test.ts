// Reglas puras del importador de proveedores (src/lib/importarProveedores.ts, mig 450).
import { describe, it, expect } from 'vitest'
import { cbuValido, condicionIvaProveedor, tipoProveedor, CONDICION_IVA_PLANTILLA } from '@/lib/importarProveedores'

// Arma un CBU válido a partir de banco+sucursal (7) y cuenta (13), calculando los verificadores.
function cbu(b7: string, c13: string) {
  const dv = (d: string, p: number[]) => (10 - (p.reduce((a, w, i) => a + w * Number(d[i]), 0) % 10)) % 10
  return b7 + dv(b7, [7, 1, 3, 9, 7, 1, 3]) + c13 + dv(c13, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])
}

describe('condicionIvaProveedor', () => {
  it('etiqueta, sigla o código → valor del CHECK de la tabla', () => {
    expect(condicionIvaProveedor('Responsable Inscripto')).toBe('responsable_inscripto')
    expect(condicionIvaProveedor('RI')).toBe('responsable_inscripto')
    expect(condicionIvaProveedor('responsable_inscripto')).toBe('responsable_inscripto')
    expect(condicionIvaProveedor('Monotributista')).toBe('monotributo')
    expect(condicionIvaProveedor('EXENTO')).toBe('exento')
    expect(condicionIvaProveedor('consumidor final')).toBe('consumidor_final')
    expect(condicionIvaProveedor('CF')).toBe('consumidor_final')
  })
  it('todas las opciones de la plantilla se reconocen', () => {
    for (const o of CONDICION_IVA_PLANTILLA) expect(condicionIvaProveedor(o)).not.toBe('invalida')
  })
  it('vacía → null; desconocida → "invalida" (no se adivina)', () => {
    expect(condicionIvaProveedor('')).toBeNull()
    expect(condicionIvaProveedor('No responsable')).toBe('invalida')
  })
})

describe('cbuValido', () => {
  const ok = cbu('0110599', '5000000123456')
  it('22 dígitos con verificadores correctos', () => {
    expect(cbuValido(ok)).toBe(true)
    expect(cbuValido(`${ok.slice(0, 8)} ${ok.slice(8)}`)).toBe(true)
  })
  it('un dígito cambiado o un largo distinto → inválido', () => {
    const malo = ok.slice(0, 10) + ((Number(ok[10]) + 1) % 10) + ok.slice(11)
    expect(cbuValido(malo)).toBe(false)
    expect(cbuValido(ok.slice(0, 21))).toBe(false)
    expect(cbuValido('')).toBe(false)
  })
})

describe('tipoProveedor', () => {
  it('vacío → proveedor; servicio; otro → inválido', () => {
    expect(tipoProveedor('')).toBe('proveedor')
    expect(tipoProveedor('Servicio')).toBe('servicio')
    expect(tipoProveedor('cliente')).toBe('invalida')
  })
})
