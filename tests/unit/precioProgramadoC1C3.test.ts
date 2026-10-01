import { describe, it, expect } from 'vitest'
import { etiquetaEsperada, etiquetaVencida } from '@/lib/precioProgramado'
import { enTandas, mensajeConflicto, type ProgramadoPendiente } from '@/lib/precioProgramadoConflicto'

// Precio programado — C-1 (el precio espera la etiqueta, mig 441) y C-3 (cambio "ahora" con un programado pendiente).

const ahora = new Date('2026-09-26T12:00:00-03:00')
const tarea = (over: Record<string, unknown> = {}) => ({
  tipo: 'cambio_precio', estado: 'pendiente', precio_anterior: 2600, precio_nuevo: 2999,
  precio_programado_id: 'pp1', vigente_desde: '2026-09-26T11:00:00-03:00', ...over,
})

describe('C-1 etiquetaEsperada', () => {
  it('modo prendido, pasó la hora y el precio nuevo no rige → espera la etiqueta (no "vencida")', () => {
    expect(etiquetaEsperada(tarea(), 2600, true, ahora)).toBe(true)
  })
  it('modo apagado → nunca (a la hora ya se aplicó; si sigue abierta es una etiqueta vencida)', () => {
    expect(etiquetaEsperada(tarea(), 2600, false, ahora)).toBe(false)
    expect(etiquetaVencida(tarea(), ahora)).toBe(true)
  })
  it('antes de la hora → no (todavía no se puede confirmar)', () => {
    expect(etiquetaEsperada(tarea({ vigente_desde: '2026-09-26T13:00:00-03:00' }), 2600, true, ahora)).toBe(false)
  })
  it('si el precio nuevo ya rige → no espera nada', () => {
    expect(etiquetaEsperada(tarea(), 2999, true, ahora)).toBe(false)
  })
  it('tarea sin programado, cerrada o de otro tipo → no', () => {
    expect(etiquetaEsperada(tarea({ precio_programado_id: null }), 2600, true, ahora)).toBe(false)
    expect(etiquetaEsperada(tarea({ estado: 'completada' }), 2600, true, ahora)).toBe(false)
    expect(etiquetaEsperada(tarea({ tipo: 'reponer' }), 2600, true, ahora)).toBe(false)
  })
})

describe('C-3 aviso de programado pendiente', () => {
  const p = (id: string, producto_id: string): ProgramadoPendiente =>
    ({ id, producto_id, precio_venta: '2999.00', vigente_desde: '2026-09-28T08:00:00-03:00' })
  const fmt = (n: number) => `$${n}`
  const fecha = () => 'lun 28/09 08:00'

  it('uno solo: nombra el producto, el precio (numeric que llega como string) y la fecha', () => {
    const m = mensajeConflicto([p('a', 'x')], fmt, fecha, { x: 'Bidón 20 L' })
    expect(m).toContain('"Bidón 20 L"')
    expect(m).toContain('$2999')
    expect(m).toContain('lun 28/09 08:00')
    expect(m).toMatch(/reemplazar el precio que estás guardando/)
  })
  it('sin nombre → "Este producto"', () => {
    expect(mensajeConflicto([p('a', 'x')], fmt, fecha)).toMatch(/^Este producto tiene/)
  })
  it('varios → cuenta cuántos', () => {
    expect(mensajeConflicto([p('a', 'x'), p('b', 'y'), p('c', 'z')], fmt, fecha)).toMatch(/^3 de estos productos/)
  })
  it('enTandas parte en grupos del tamaño pedido sin perder ninguno', () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`)
    const t = enTandas(ids, 200)
    expect(t.map(x => x.length)).toEqual([200, 200, 50])
    expect(t.flat()).toEqual(ids)
    expect(enTandas([], 200)).toEqual([])
  })
})
