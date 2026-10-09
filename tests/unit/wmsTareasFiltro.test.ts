import { describe, it, expect } from 'vitest'
import {
  parsearPildoraTareaWms, evaluarPildorasTareaWms, tareaWmsFiltrable, type PildoraTareaWms,
} from '@/lib/wmsTareasFiltro'

// Fila como la trae la tab Tareas WMS (con sus embeds).
const fila = (o: Record<string, unknown> = {}) => tareaWmsFiltrable({
  lpn_origen: 'LPN-20260623-D1BB1E',
  productos: { nombre: 'Bebida Sprite 2.5L', sku: '7801610005521' },
  ubicacion_origen: { nombre: 'Alacena1' },
  usuario_asignado: null,
  pedidos: { numero: 70, cliente_nombre: null, clientes: { nombre: 'Fede Messina' }, venta: { numero: 1536 } },
  envios: null,
  ...o,
})
const ok = (texto: string, t = fila()) => {
  const p = parsearPildoraTareaWms(texto) ?? ({ id: 'x', campo: 'libre', operador: 'contiene', valor: texto } as PildoraTareaWms)
  return evaluarPildorasTareaWms(t, [p], 'Y')
}

describe('filtro de Tareas WMS', () => {
  it('🔴 CLAVE: Pedido/Envío/Venta son EXACTOS ("Pedido:7" no trae el 70)', () => {
    expect(ok('Pedido:70')).toBe(true)
    expect(ok('Pedido:7')).toBe(false)
    expect(ok('Venta:1536')).toBe(true)
    expect(ok('Venta:153')).toBe(false)
    expect(ok('Envío:52', fila({ pedidos: null, envios: { numero: 52, venta: { numero: 900 } } }))).toBe(true)
    expect(ok('Venta:900', fila({ pedidos: null, envios: { numero: 52, venta: { numero: 900 } } }))).toBe(true)
  })
  it('un número suelto busca ese pedido, envío o venta exacto (y SKU/LPN que lo contengan)', () => {
    expect(ok('70')).toBe(true)
    expect(ok('1536')).toBe(true)
    expect(ok('71')).toBe(false)   // ni pedido 71 ni contenido en SKU/LPN
    expect(ok('0005521')).toBe(true)
  })
  it('texto: producto, SKU, LPN, ubicación, cliente y operario', () => {
    expect(ok('sprite')).toBe(true)
    expect(ok('Producto:sprite')).toBe(true)
    expect(ok('Ubicación:alacena')).toBe(true)
    expect(ok('Cliente:messina')).toBe(true)
    expect(ok('LPN:D1BB1E')).toBe(true)
    expect(ok('Asignada:sin asignar')).toBe(true)
    expect(ok('coca')).toBe(false)
  })
  it('"#70" funciona igual que "70"', () => {
    expect(ok('Pedido:#70')).toBe(true)
  })
})
