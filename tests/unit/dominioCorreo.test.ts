import { describe, it, expect } from 'vitest'
import { sugerenciaCorreo } from '@/lib/dominioCorreo'

describe('sugerenciaCorreo — dominios mal tipeados', () => {
  it('el caso real: outloock.com → outlook.com', () => {
    expect(sugerenciaCorreo('juan@outloock.com')).toBe('juan@outlook.com')
  })
  it('errores típicos', () => {
    expect(sugerenciaCorreo('ana@gmial.com')).toBe('ana@gmail.com')
    expect(sugerenciaCorreo('ana@hotmial.com')).toBe('ana@hotmail.com')
    expect(sugerenciaCorreo('ana@hotmail.con')).toBe('ana@hotmail.com')
    expect(sugerenciaCorreo('Ana@Gmail.co')).toBe('ana@gmail.com')
  })
  it('dominios correctos o propios de una empresa: sin sugerencia', () => {
    expect(sugerenciaCorreo('ana@gmail.com')).toBeNull()
    expect(sugerenciaCorreo('ana@hotmail.com.ar')).toBeNull()
    expect(sugerenciaCorreo('ventas@maderaselsur.com.ar')).toBeNull()
    expect(sugerenciaCorreo('dueño@agnestudio.com')).toBeNull()
  })
  it('entradas incompletas: sin sugerencia', () => {
    expect(sugerenciaCorreo('ana')).toBeNull()
    expect(sugerenciaCorreo('ana@')).toBeNull()
    expect(sugerenciaCorreo('@gmail.com')).toBeNull()
  })
})
