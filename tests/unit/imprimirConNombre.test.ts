import { describe, it, expect, vi, afterEach } from 'vitest'
import { imprimirConNombre } from '@/lib/imprimirConNombre'

describe('imprimirConNombre', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('imprime con el nombre del documento (sin .pdf) y restaura el título en afterprint', () => {
    document.title = 'Genesis360'
    let tituloAlImprimir = ''
    vi.spyOn(window, 'print').mockImplementation(() => { tituloAlImprimir = document.title })
    imprimirConNombre('Ticket_Venta_34.pdf')
    expect(tituloAlImprimir).toBe('Ticket_Venta_34')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe('Genesis360')
  })

  it('si afterprint no llega (iOS), restaura el título al minuto', () => {
    vi.useFakeTimers()
    document.title = 'Genesis360'
    vi.spyOn(window, 'print').mockImplementation(() => {})
    imprimirConNombre('Picking_Pedido_7')
    expect(document.title).toBe('Picking_Pedido_7')
    vi.advanceTimersByTime(60_000)
    expect(document.title).toBe('Genesis360')
  })
})
