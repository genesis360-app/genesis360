// "Stock antes" de los movimientos (src/lib/stockSucursal.ts). 🛑 REGLA #0: con series se cuentan las series de la
// sucursal; antes se sumaban cantidades de línea (siempre 0 en productos con series) y el historial quedaba en 0.
import { describe, it, expect } from 'vitest'
import { stockEnSucursal } from '@/lib/stockSucursal'

/** Cliente mínimo: cada tabla devuelve lo configurado y registra los filtros que recibió. */
function clienteFalso(tablas: Record<string, { data?: unknown; count?: number; error?: { message: string } }>) {
  const filtros: Record<string, string[]> = {}
  const from = (tabla: string) => {
    filtros[tabla] = []
    const r = tablas[tabla]
    const q: any = {
      select: () => q,
      eq: (c: string, v: string) => { filtros[tabla].push(`${c}=${v}`); return q },
      single: () => Promise.resolve({ data: r.data, error: r.error ?? null }),
      then: (ok: any) => ok({ data: r.data, count: r.count, error: r.error ?? null }),
    }
    return q
  }
  return { cliente: { from }, filtros }
}

describe('stockEnSucursal', () => {
  it('sin sucursal → stock global del producto', async () => {
    const { cliente } = clienteFalso({ productos: { data: { stock_actual: 12, tiene_series: true } } })
    expect(await stockEnSucursal(cliente, 't', 'p', null)).toBe(12)
  })

  it('🛑 con series → cuenta las series activas de la sucursal (no suma cantidades de línea)', async () => {
    const { cliente, filtros } = clienteFalso({
      productos: { data: { stock_actual: 40, tiene_series: true } },
      inventario_series: { count: 26 },
      inventario_lineas: { data: [{ cantidad: 0 }, { cantidad: 0 }] },
    })
    expect(await stockEnSucursal(cliente, 't', 'p', 's1')).toBe(26)
    expect(filtros.inventario_series).toContain('inventario_lineas.sucursal_id=s1')
    expect(filtros.inventario_series).toContain('inventario_lineas.activo=true')
    expect(filtros.inventario_lineas, 'no tiene que sumar líneas para un producto con series').toBeUndefined()
  })

  it('sin series → suma las cantidades de las líneas activas de la sucursal', async () => {
    const { cliente, filtros } = clienteFalso({
      productos: { data: { stock_actual: 99, tiene_series: false } },
      inventario_lineas: { data: [{ cantidad: 5 }, { cantidad: '3' }] },
    })
    expect(await stockEnSucursal(cliente, 't', 'p', 's1')).toBe(8)
    expect(filtros.inventario_lineas).toEqual(expect.arrayContaining(['sucursal_id=s1', 'activo=true']))
  })

  it('si la base falla, no inventa un 0: lanza', async () => {
    const { cliente } = clienteFalso({
      productos: { data: { tiene_series: false } },
      inventario_lineas: { error: { message: 'timeout' } },
    })
    await expect(stockEnSucursal(cliente, 't', 'p', 's1')).rejects.toThrow(/No se pudo leer el stock/)
  })
})
