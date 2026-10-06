import { describe, it, expect } from 'vitest'
import { cotizarRecurrente, totalRecurrente, type RecurrenteItemSnapshot } from '@/lib/ventasRecurrentes'

const item = (o: Partial<RecurrenteItemSnapshot>): RecurrenteItemSnapshot => ({
  producto_id: 'p1', nombre: 'Bidón 20 L', cantidad: 2, precio_unitario: 100, descuento: 0, alicuota_iva: 21, subtotal: 200, ...o,
})

describe('cotizarRecurrente — la plantilla se cotiza con el motor único, no con el precio congelado', () => {
  it('usa el precio del motor (hoy), no el de la plantilla', () => {
    const { lineas, total } = cotizarRecurrente([item({})], { p1: { precio_unitario: 150, mecanismo: 'lista' } }, { p1: 21 })
    expect(lineas[0].precio_unitario).toBe(150)
    expect(lineas[0].subtotal).toBe(300)
    expect(total).toBe(300)
    expect(totalRecurrente([item({})])).toBe(200)   // la plantilla guardada no cambia
  })

  it('aplica la categoría del cliente y guarda mecanismo + lo que bajó la categoría (F2/F3)', () => {
    const { lineas } = cotizarRecurrente([item({})],
      { p1: { precio_unitario: 120, mecanismo: 'categoria', descuentoCategoria: 60 } }, { p1: 21 })
    expect(lineas[0]).toMatchObject({ precio_unitario: 120, mecanismo_precio: 'categoria', descuento_categoria_monto: 60 })
  })

  it('conserva el descuento manual % de la línea', () => {
    const { lineas } = cotizarRecurrente([item({ descuento: 10 })], { p1: { precio_unitario: 100 } }, { p1: 21 })
    expect(lineas[0].subtotal).toBe(180)
    expect(lineas[0].descuento).toBe(10)
  })

  it('🛑 alícuota ACTUAL del producto; Exento (0) sigue siendo 0 aunque llegue como string', () => {
    const { lineas } = cotizarRecurrente([item({ alicuota_iva: 21 })], { p1: { precio_unitario: 100 } }, { p1: '0.00' })
    expect(lineas[0].alicuota_iva).toBe(0)
    expect(lineas[0].iva_monto).toBe(0)
    const r = cotizarRecurrente([item({})], { p1: { precio_unitario: 121 } }, { p1: '21.00' })
    expect(r.lineas[0].iva_monto).toBe(42)   // 242 − 242/1,21
  })

  it('🛑 sin precio del servidor no genera nada (nunca se inventa un precio)', () => {
    expect(() => cotizarRecurrente([item({})], {}, { p1: 21 })).toThrow(/Bidón 20 L/)
    expect(() => cotizarRecurrente([item({})], { p1: { error: 'Producto inactivo' } }, { p1: 21 })).toThrow(/inactivo/)
    expect(() => cotizarRecurrente([item({})], { p1: { precio_unitario: 100 } }, {})).toThrow(/alícuota/)
  })
})
