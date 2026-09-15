import { describe, it, expect } from 'vitest'
import {
  combinarFechaHora, validarVigencia, cambioDePrecio, vigenciaSugerida, formatearVigencia,
} from '../../src/lib/precioProgramado'

describe('combinarFechaHora', () => {
  it('arma la fecha en hora local', () => {
    const d = combinarFechaHora('2026-09-20', '14:30')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 20, 14, 30])
  })

  it('rechaza formatos inválidos y fechas que no existen', () => {
    expect(combinarFechaHora('', '14:30')).toBeNull()
    expect(combinarFechaHora('2026-09-20', '')).toBeNull()
    expect(combinarFechaHora('20/09/2026', '14:30')).toBeNull()
    expect(combinarFechaHora('2026-02-31', '10:00')).toBeNull()
    expect(combinarFechaHora('2026-09-20', '25:00')).toBeNull()
  })
})

describe('validarVigencia', () => {
  const ahora = new Date(2026, 8, 14, 10, 0, 0)

  it('acepta una fecha futura razonable', () => {
    const r = validarVigencia('2026-09-15', '08:00', ahora)
    expect(r.ok).toBe(true)
  })

  it('🔴 CLAVE: rechaza el pasado y lo que está a menos de 2 minutos (la base exige 1)', () => {
    expect(validarVigencia('2026-09-14', '09:59', ahora).ok).toBe(false)
    expect(validarVigencia('2026-09-14', '10:01', ahora).ok).toBe(false)
    expect(validarVigencia('2026-09-14', '10:03', ahora).ok).toBe(true)
  })

  it('rechaza más de un año', () => {
    const r = validarVigencia('2027-10-01', '10:00', ahora)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/año/)
  })

  it('pide fecha y hora si faltan', () => {
    const r = validarVigencia('', '', ahora)
    expect(r.ok).toBe(false)
  })
})

describe('cambioDePrecio', () => {
  it('detecta un cambio real y normaliza el numeric que llega como string', () => {
    expect(cambioDePrecio('1500.00', 1600)).toBe(true)
    expect(cambioDePrecio('1500.00', '1500')).toBe(false)
  })

  it('ignora diferencias menores a medio centavo', () => {
    expect(cambioDePrecio(1500, 1500.004)).toBe(false)
    expect(cambioDePrecio(1500, 1500.01)).toBe(true)
  })
})

describe('vigenciaSugerida / formatearVigencia', () => {
  it('propone mañana a las 08:00', () => {
    expect(vigenciaSugerida(new Date(2026, 8, 30, 22, 15))).toEqual({ fecha: '2026-10-01', hora: '08:00' })
  })

  it('formatea dd/mm/aaaa hh:mm', () => {
    expect(formatearVigencia(new Date(2026, 8, 5, 7, 3))).toBe('05/09/2026 07:03')
    expect(formatearVigencia('no-es-fecha')).toBe('')
  })
})
