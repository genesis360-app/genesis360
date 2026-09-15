import { describe, it, expect } from 'vitest'
import { esDelModulo, ordenarParaModulo, formatearDuracion, type AyudaRecurso } from '@/lib/ayudaRecursos'

const recurso = (id: string, modulo: string | null, orden = 100, titulo = id): AyudaRecurso => ({
  id, titulo, descripcion: null, modulo, video_path: `${id}.mp4`, miniatura_path: null, duracion_seg: null, orden,
})

describe('esDelModulo', () => {
  it('coincide con la ruta exacta y sus subrutas', () => {
    expect(esDelModulo(recurso('a', '/ventas'), '/ventas')).toBe(true)
    expect(esDelModulo(recurso('a', '/ventas'), '/ventas/historial')).toBe(true)
  })
  it('no confunde prefijos de otra ruta ni recursos generales', () => {
    expect(esDelModulo(recurso('a', '/ventas'), '/ventasx')).toBe(false)
    expect(esDelModulo(recurso('a', null), '/ventas')).toBe(false)
    expect(esDelModulo(recurso('a', '/ventas'), undefined)).toBe(false)
  })
})

describe('ordenarParaModulo', () => {
  const lista = [
    recurso('general', null, 1),
    recurso('caja', '/caja', 2),
    recurso('ventas-2', '/ventas', 20),
    recurso('ventas-1', '/ventas', 10),
  ]

  it('pone primero los del módulo actual, cada grupo por orden', () => {
    expect(ordenarParaModulo(lista, '/ventas').map(r => r.id)).toEqual(['ventas-1', 'ventas-2', 'general', 'caja'])
  })
  it('sin módulo, ordena solo por orden', () => {
    expect(ordenarParaModulo(lista).map(r => r.id)).toEqual(['general', 'caja', 'ventas-1', 'ventas-2'])
  })
  it('desempata por título y no modifica la lista original', () => {
    const empatados = [recurso('b', null, 5, 'Zeta'), recurso('a', null, 5, 'Alfa')]
    expect(ordenarParaModulo(empatados).map(r => r.titulo)).toEqual(['Alfa', 'Zeta'])
    expect(empatados.map(r => r.titulo)).toEqual(['Zeta', 'Alfa'])
  })
})

describe('formatearDuracion', () => {
  it('minutos y segundos', () => {
    expect(formatearDuracion(95)).toBe('1:35')
    expect(formatearDuracion(59)).toBe('0:59')
  })
  it('con horas', () => {
    expect(formatearDuracion(3605)).toBe('1:00:05')
  })
  it('sin dato o inválido', () => {
    expect(formatearDuracion(null)).toBeNull()
    expect(formatearDuracion(undefined)).toBeNull()
    expect(formatearDuracion(0)).toBeNull()
    expect(formatearDuracion(Number.NaN)).toBeNull()
  })
})
