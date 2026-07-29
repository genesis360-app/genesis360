import { describe, it, expect } from 'vitest'
import {
  esPedidoParaMostrador, filtrarPedidosMostrador, canalesAutoValidos, ventaGeneraPedido,
  type PedidoMostrador,
} from '../../src/lib/pedidoVenta'

const base: PedidoMostrador = {
  id: 'p1', numero: 10, numero_sucursal: 3, estado: 'listo_para_entrega',
  requiere_envio: false, venta_origen_id: 'v1', cliente_nombre: 'Juan Pérez', cliente_dni: '30.123.456',
}

describe('esPedidoParaMostrador', () => {
  it('listo + retiro en local + nacido de una venta → se muestra', () => {
    expect(esPedidoParaMostrador(base)).toBe(true)
  })

  it('todavía en preparación → NO (el mostrador no puede entregar lo que no está armado)', () => {
    expect(esPedidoParaMostrador({ ...base, estado: 'en_preparacion' })).toBe(false)
    expect(esPedidoParaMostrador({ ...base, estado: 'confirmado' })).toBe(false)
  })

  it('ya entregado → NO (sale de la lista apenas se entrega)', () => {
    expect(esPedidoParaMostrador({ ...base, estado: 'entregado' })).toBe(false)
  })

  it('sale por envío → NO es del mostrador', () => {
    expect(esPedidoParaMostrador({ ...base, requiere_envio: true })).toBe(false)
  })

  it('pedido de logística puro (sin venta) → NO: ese se entrega desde /pedidos, que le genera la venta', () => {
    expect(esPedidoParaMostrador({ ...base, venta_origen_id: null })).toBe(false)
  })
})

describe('filtrarPedidosMostrador', () => {
  const pedidos: PedidoMostrador[] = [
    base,
    { ...base, id: 'p2', numero: 11, numero_sucursal: 4, cliente_nombre: 'María López', cliente_dni: '27888999' },
    { ...base, id: 'p3', numero: 12, numero_sucursal: 5, cliente_nombre: null, cliente_dni: null },
  ]

  it('sin término devuelve todo', () => {
    expect(filtrarPedidosMostrador(pedidos, '')).toHaveLength(3)
    expect(filtrarPedidosMostrador(pedidos, '   ')).toHaveLength(3)
  })

  it('busca por nombre, sin importar mayúsculas ni tildes', () => {
    expect(filtrarPedidosMostrador(pedidos, 'perez').map(p => p.id)).toEqual(['p1'])
    expect(filtrarPedidosMostrador(pedidos, 'MARÍA').map(p => p.id)).toEqual(['p2'])
  })

  it('busca por DNI aunque esté cargado con puntos', () => {
    expect(filtrarPedidosMostrador(pedidos, '30123456').map(p => p.id)).toEqual(['p1'])
    expect(filtrarPedidosMostrador(pedidos, '30.123.456').map(p => p.id)).toEqual(['p1'])
  })

  it('el DNI matchea por PREFIJO, no por "contiene"', () => {
    expect(filtrarPedidosMostrador(pedidos, '301').map(p => p.id)).toEqual(['p1'])
    // "123456" está DENTRO del DNI de p1 pero no lo empieza → no matchea
    expect(filtrarPedidosMostrador(pedidos, '123456')).toEqual([])
  })

  it('una búsqueda numérica corta no arrastra DNIs que contengan ese dígito', () => {
    // "5" es el N° de sucursal de p3; el DNI de p1 (30.123.456) también tiene un 5 y NO debe salir
    expect(filtrarPedidosMostrador(pedidos, '5').map(p => p.id)).toEqual(['p3'])
  })

  it('busca por número de pedido — el del tenant y el de la sucursal', () => {
    expect(filtrarPedidosMostrador(pedidos, '12').map(p => p.id)).toEqual(['p3'])
    expect(filtrarPedidosMostrador(pedidos, '4').map(p => p.id)).toEqual(['p2'])
  })

  it('un pedido sin cliente sigue siendo encontrable por su número', () => {
    expect(filtrarPedidosMostrador(pedidos, '5').map(p => p.id)).toEqual(['p3'])
  })

  it('sin coincidencias → vacío (nunca cae a "mostrar todo")', () => {
    expect(filtrarPedidosMostrador(pedidos, 'Rodríguez')).toEqual([])
  })
})

describe('canalesAutoValidos', () => {
  const canales = [{ id: 'a', activo: true }, { id: 'b', activo: true }, { id: 'c', activo: false }]

  it('conserva solo los canales vivos', () => {
    expect(canalesAutoValidos(['a', 'b'], canales)).toEqual(['a', 'b'])
  })

  it('descarta un canal desactivado que quedó guardado', () => {
    expect(canalesAutoValidos(['a', 'c'], canales)).toEqual(['a'])
  })

  it('descarta un canal borrado que quedó guardado', () => {
    expect(canalesAutoValidos(['a', 'zzz'], canales)).toEqual(['a'])
  })

  it('config ausente o corrupta → vacío, no rompe', () => {
    expect(canalesAutoValidos(null, canales)).toEqual([])
    expect(canalesAutoValidos(undefined, canales)).toEqual([])
    expect(canalesAutoValidos('no-es-array', canales)).toEqual([])
    expect(canalesAutoValidos([1, 2], canales)).toEqual([])
  })
})

// 💵 Espejo informativo del trigger `trg_venta_auto_pedido` (mig 315). La decisión REAL la toma el
// servidor; esto solo alimenta avisos en el POS.
describe('ventaGeneraPedido', () => {
  const canales = ['wsp']

  it('venta despachada de un canal configurado → genera', () => {
    expect(ventaGeneraPedido({ estado: 'despachada', canal_id: 'wsp', total: 100 }, canales)).toBe(true)
  })

  it('canal NO configurado → no genera', () => {
    expect(ventaGeneraPedido({ estado: 'despachada', canal_id: 'otro', total: 100 }, canales)).toBe(false)
  })

  it('sin canal resuelto → no genera', () => {
    expect(ventaGeneraPedido({ estado: 'despachada', canal_id: null, total: 100 }, canales)).toBe(false)
  })

  it('venta anulada/devuelta → no genera', () => {
    expect(ventaGeneraPedido({ estado: 'devuelta', canal_id: 'wsp', total: 100 }, canales)).toBe(false)
    expect(ventaGeneraPedido({ estado: 'cancelada', canal_id: 'wsp', total: 100 }, canales)).toBe(false)
  })

  it('reserva con seña parcial → NO genera todavía', () => {
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 1000, monto_pagado: 400 }, canales)).toBe(false)
  })

  it('reserva 100% pagada → genera', () => {
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 1000, monto_pagado: 1000 }, canales)).toBe(true)
  })

  it('💵 el costo de envío cuenta para el 100%: total NO lo incluye pero monto_pagado SÍ (ISS-105)', () => {
    // 1000 de mercadería + 200 de envío = 1200 a cobrar. Pagar 1000 NO es el 100%.
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 1000, costo_envio: 200, monto_pagado: 1000 }, canales)).toBe(false)
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 1000, costo_envio: 200, monto_pagado: 1200 }, canales)).toBe(true)
  })

  it('una seña de más (redondeo) no deja el pedido sin generar', () => {
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 1000, monto_pagado: 1000.5 }, canales)).toBe(true)
  })

  it('reserva de total 0 no genera (no hay nada cobrado que valide la entrega)', () => {
    expect(ventaGeneraPedido({ estado: 'reservada', canal_id: 'wsp', total: 0, monto_pagado: 0 }, canales)).toBe(false)
  })
})
