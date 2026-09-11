import { describe, it, expect } from 'vitest'
import { diffCampos } from '@/lib/actividadLogDiff'

// Plan: issue #9 de Fede (2026-09-08) — el historial no mostraba QUÉ se editó de un producto.
describe('diffCampos — el detalle que va al historial', () => {
  const etiquetas = { nombre: 'nombre', precio_venta: 'precio de venta', activo: 'activo' }

  it('devuelve solo los campos que cambiaron', () => {
    const cambios = diffCampos(
      { nombre: 'Coca 2L', precio_venta: 1500, activo: true },
      { nombre: 'Coca 2.5L', precio_venta: 1500, activo: true },
      etiquetas,
    )
    expect(cambios).toEqual([{ campo: 'nombre', anterior: 'Coca 2L', nuevo: 'Coca 2.5L' }])
  })

  it('🛑 el numeric de Postgres llega como string: "1500.00" vs 1500 NO es un cambio', () => {
    // Sin esto el historial se llenaba de ruido en cada guardado, aunque nadie tocara el precio.
    expect(diffCampos({ precio_venta: '1500.00' }, { precio_venta: 1500 }, etiquetas)).toEqual([])
    expect(diffCampos({ precio_venta: '1500.00' }, { precio_venta: 1600 }, etiquetas))
      .toEqual([{ campo: 'precio de venta', anterior: '1500.00', nuevo: '1600' }])
  })

  it('trata null, undefined y "" como el mismo "vacío"', () => {
    expect(diffCampos({ nombre: null }, { nombre: '' }, etiquetas)).toEqual([])
    expect(diffCampos({ nombre: undefined }, { nombre: null }, etiquetas)).toEqual([])
  })

  it('los booleanos se leen en castellano, no como true/false', () => {
    expect(diffCampos({ activo: true }, { activo: false }, etiquetas))
      .toEqual([{ campo: 'activo', anterior: 'sí', nuevo: 'no' }])
  })

  it('un campo que se vacía queda con nuevo=null (el historial lo muestra como "eliminado")', () => {
    expect(diffCampos({ nombre: 'Algo' }, { nombre: '' }, etiquetas))
      .toEqual([{ campo: 'nombre', anterior: 'Algo', nuevo: null }])
  })

  it('ignora las claves que no están en el mapa de etiquetas — el historial es para humanos', () => {
    expect(diffCampos({ tenant_id: 'a', nombre: 'X' }, { tenant_id: 'b', nombre: 'X' }, etiquetas)).toEqual([])
  })

  it('sin fila original (alta) no hay diff', () => {
    expect(diffCampos(null, { nombre: 'Nuevo' }, etiquetas)).toEqual([])
  })
})
