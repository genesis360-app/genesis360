import { describe, it, expect } from 'vitest'
import {
  esPedidoParaMostrador, filtrarPedidosMostrador, canalesExcluidosValidos,
  ventaRequierePedido, saldoParaEntregar, resumenPagoTicket, motivoNoLanzarPedido,
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

describe('canalesExcluidosValidos', () => {
  const canales = [{ id: 'a', activo: true }, { id: 'b', activo: true }, { id: 'c', activo: false }]

  it('conserva solo los canales vivos', () => {
    expect(canalesExcluidosValidos(['a', 'b'], canales)).toEqual(['a', 'b'])
  })

  it('descarta un canal desactivado que quedó guardado', () => {
    expect(canalesExcluidosValidos(['a', 'c'], canales)).toEqual(['a'])
  })

  it('descarta un canal borrado que quedó guardado', () => {
    expect(canalesExcluidosValidos(['a', 'zzz'], canales)).toEqual(['a'])
  })

  it('config ausente o corrupta → vacío, no rompe', () => {
    expect(canalesExcluidosValidos(null, canales)).toEqual([])
    expect(canalesExcluidosValidos(undefined, canales)).toEqual([])
    expect(canalesExcluidosValidos('no-es-array', canales)).toEqual([])
    expect(canalesExcluidosValidos([1, 2], canales)).toEqual([])
  })
})

// Las 8 ramas del diagrama de flujo de GO. Espejo informativo de `fn_venta_requiere_pedido`
// (mig 318) — la decisión REAL la toma el servidor.
describe('ventaRequierePedido — las 8 ramas del diagrama', () => {
  const online = { canal_clasificacion: 'online' as const }
  const pres   = { canal_clasificacion: 'presencial' as const }

  // ── VENTA ONLINE: las 4 ramas generan pedido ──
  it('1· online · retiro local con pago PARCIAL → genera (el pago ya no condiciona)', () => {
    expect(ventaRequierePedido({ ...online, estado: 'despachada' })).toBe(true)
  })
  it('2· online · retiro local con pago COMPLETO → genera', () => {
    expect(ventaRequierePedido({ ...online, estado: 'despachada' })).toBe(true)
  })
  it('3· online · envío propio → genera', () => {
    expect(ventaRequierePedido({ ...online, estado: 'despachada', con_envio: true })).toBe(true)
  })
  it('4· online · envío de tercero → genera', () => {
    expect(ventaRequierePedido({ ...online, estado: 'despachada', con_envio: true })).toBe(true)
  })

  // ── COMPRAS LOCAL: solo la entrega directa queda afuera ──
  it('5· 🛑 mostrador · ENTREGA DIRECTA → NO genera (el cliente se lo llevó)', () => {
    expect(ventaRequierePedido({ ...pres, estado: 'despachada' })).toBe(false)
  })
  it('6· mostrador · reserva → genera aunque tenga seña parcial', () => {
    expect(ventaRequierePedido({ ...pres, estado: 'reservada' })).toBe(true)
  })
  it('7· mostrador · envío propio → genera', () => {
    expect(ventaRequierePedido({ ...pres, estado: 'despachada', con_envio: true })).toBe(true)
  })
  it('8· mostrador · envío de tercero → genera', () => {
    expect(ventaRequierePedido({ ...pres, estado: 'despachada', con_envio: true })).toBe(true)
  })

  // ── Bordes ──
  it('🛑 un PRESUPUESTO no genera pedido, ni siquiera con envío', () => {
    // Lo encontró GO: una venta recurrente generó un presupuesto, el presupuesto generó un pedido,
    // y al cancelarse quedó el pedido vivo para que el depósito preparara mercadería inexistente.
    expect(ventaRequierePedido({ ...pres, estado: 'pendiente' })).toBe(false)
    expect(ventaRequierePedido({ ...online, estado: 'pendiente' })).toBe(false)
    expect(ventaRequierePedido({ ...online, estado: 'pendiente', con_envio: true })).toBe(false)
  })

  it('…pero al convertirse en venta real sí (el trigger escucha el cambio de estado)', () => {
    expect(ventaRequierePedido({ ...pres, estado: 'reservada' })).toBe(true)
    expect(ventaRequierePedido({ ...online, estado: 'despachada' })).toBe(true)
  })

  it('una venta facturada sigue viva y puede necesitar preparación', () => {
    expect(ventaRequierePedido({ ...online, estado: 'facturada' })).toBe(true)
    // salvo que sea entrega directa
    expect(ventaRequierePedido({ ...pres, estado: 'facturada' })).toBe(false)
  })
  it('venta anulada o devuelta → nunca genera', () => {
    expect(ventaRequierePedido({ ...online, estado: 'cancelada' })).toBe(false)
    expect(ventaRequierePedido({ ...online, estado: 'devuelta', con_envio: true })).toBe(false)
  })
  it('sin canal resuelto se asume presencial — no inventa trabajo de depósito', () => {
    expect(ventaRequierePedido({ estado: 'despachada' })).toBe(false)
    expect(ventaRequierePedido({ estado: 'despachada', canal_clasificacion: null })).toBe(false)
  })
  it('un canal excluido en Config queda afuera aunque le correspondiera', () => {
    expect(ventaRequierePedido({ ...online, estado: 'reservada', canal_id: 'x' }, ['x'])).toBe(false)
    expect(ventaRequierePedido({ ...online, estado: 'reservada', canal_id: 'x' }, ['otro'])).toBe(true)
  })
})

// 💵 Caja "Debe validar pago total" del diagrama.
describe('saldoParaEntregar', () => {
  it('venta saldada → 0', () => {
    expect(saldoParaEntregar({ total: 1000, monto_pagado: 1000 })).toBe(0)
  })
  it('reserva con seña parcial → devuelve lo que falta', () => {
    expect(saldoParaEntregar({ total: 1000, monto_pagado: 400 })).toBe(600)
  })
  it('💵 el costo de envío cuenta: total NO lo incluye pero monto_pagado SÍ (ISS-105)', () => {
    expect(saldoParaEntregar({ total: 1000, costo_envio: 200, monto_pagado: 1000 })).toBe(200)
    expect(saldoParaEntregar({ total: 1000, costo_envio: 200, monto_pagado: 1200 })).toBe(0)
  })
  it('cuenta corriente → 0: la deuda es a propósito, no traba la entrega', () => {
    expect(saldoParaEntregar({ total: 1000, monto_pagado: 0, es_cuenta_corriente: true })).toBe(0)
  })
  it('medio peso de redondeo no traba una entrega', () => {
    expect(saldoParaEntregar({ total: 1000, monto_pagado: 999.7 })).toBe(0)
  })
})

// 💵 Lo que el ticket le dice al cliente sobre su pago. GO: "muestra el total y lo pagado,
// pero en ningún lado dice cuánto falta" — y desde la mig 318 sin saldar no se entrega.
describe('resumenPagoTicket', () => {
  it('venta cobrada entera → no muestra saldo', () => {
    const r = resumenPagoTicket({ estado: 'despachada', total: 2500, monto_pagado: 2500 })
    expect(r.saldo).toBe(0)
    expect(r.mostrarSaldo).toBe(false)
  })

  it('reserva con seña parcial → el saldo es lo que falta (el caso de GO: 2500 − 2000)', () => {
    const r = resumenPagoTicket({ estado: 'reservada', total: 2500, monto_pagado: 2000 })
    expect(r.pagado).toBe(2000)
    expect(r.saldo).toBe(500)
    expect(r.mostrarSaldo).toBe(true)
  })

  it('💵 el envío entra en el saldo: total NO lo incluye pero monto_pagado SÍ (ISS-105)', () => {
    // Si se comparara contra `total` a secas, le diría al cliente que ya no debe nada.
    const r = resumenPagoTicket({ estado: 'reservada', total: 2500, costo_envio: 300, monto_pagado: 2500 })
    expect(r.totalConTodo).toBe(2800)
    expect(r.saldo).toBe(300)
  })

  it('suma también el envío de logística', () => {
    const r = resumenPagoTicket({ estado: 'reservada', total: 1000, costo_envio: 200, costo_envio_logistica: 150, monto_pagado: 1000 })
    expect(r.totalConTodo).toBe(1350)
    expect(r.saldo).toBe(350)
  })

  it('un PRESUPUESTO no reclama saldo — todavía no es una venta', () => {
    const r = resumenPagoTicket({ estado: 'pendiente', total: 2500, monto_pagado: 0 })
    expect(r.saldo).toBe(2500)
    expect(r.mostrarSaldo).toBe(false)
  })

  it('medio peso de redondeo no imprime un saldo fantasma', () => {
    expect(resumenPagoTicket({ estado: 'despachada', total: 1000, monto_pagado: 999.7 }).mostrarSaldo).toBe(false)
  })

  it('venta sin monto_pagado cargado → el saldo es el total, no rompe', () => {
    const r = resumenPagoTicket({ estado: 'reservada', total: 800 })
    expect(r.saldo).toBe(800)
    expect(r.mostrarSaldo).toBe(true)
  })
})

// 🐛 Hallazgo de GO: el pedido de una venta anulada quedaba vivo y se podía lanzar.
describe('motivoNoLanzarPedido', () => {
  it('venta viva sin rebajar todavía → se puede lanzar', () => {
    expect(motivoNoLanzarPedido('reservada')).toBeNull()
  })

  it('🛑 venta cancelada o devuelta → no se prepara mercadería para algo que ya no existe', () => {
    expect(motivoNoLanzarPedido('cancelada')).toContain('ya no existe')
    expect(motivoNoLanzarPedido('devuelta')).toContain('ya no existe')
  })

  it('🛑 la venta sigue siendo un presupuesto → primero se confirma', () => {
    expect(motivoNoLanzarPedido('pendiente')).toContain('PRESUPUESTO')
  })

  it('🛑 rebaje por un solo camino: venta ya despachada/facturada → no se lanza picking de nuevo', () => {
    expect(motivoNoLanzarPedido('despachada')).toContain('ya se rebajó')
    expect(motivoNoLanzarPedido('facturada')).toContain('ya se rebajó')
  })

  it('pedido de logística puro (sin venta) → no aplica', () => {
    expect(motivoNoLanzarPedido(null)).toBeNull()
    expect(motivoNoLanzarPedido(undefined)).toBeNull()
  })
})
