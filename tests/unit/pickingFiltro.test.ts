import { describe, it, expect } from 'vitest'
import {
  parsearPildora, operadoresValidosParaCampo, operadorAjustado, evaluarPildora, evaluarPildoras,
  formatearPildora, esCampoNumerico, type Pildora, type TareaFiltrable,
} from '@/lib/pickingFiltro'

// GO probando /picking: escribir un número de pedido lo tomaba como LPN/SKU/etc. a la vez. Cada
// "píldora" fija el campo explícito (Pedido/Venta/Envío/LPN/SKU/Producto), varias se combinan con
// UN combinador global Y/O (no árbol de expresiones anidado — no lo pidieron).

describe('parsearPildora', () => {
  it('reconoce "Campo:valor" (contiene)', () => {
    expect(parsearPildora('Pedido:20')).toMatchObject({ campo: 'pedido', operador: 'contiene', valor: '20' })
  })

  it('acepta "=" como sinónimo de ":" (contiene, no exacto)', () => {
    expect(parsearPildora('sku=43')).toMatchObject({ campo: 'sku', operador: 'contiene', valor: '43' })
  })

  it('reconoce "!=" y "<>" como no_contiene', () => {
    expect(parsearPildora('venta!=12')).toMatchObject({ campo: 'venta', operador: 'no_contiene', valor: '12' })
    expect(parsearPildora('venta<>12')).toMatchObject({ campo: 'venta', operador: 'no_contiene', valor: '12' })
  })

  it('reconoce >, <, >=, <= sin confundir el de 2 caracteres con el de 1', () => {
    expect(parsearPildora('pedido>50')).toMatchObject({ campo: 'pedido', operador: 'mayor', valor: '50' })
    expect(parsearPildora('pedido<50')).toMatchObject({ campo: 'pedido', operador: 'menor', valor: '50' })
    expect(parsearPildora('pedido>=50')).toMatchObject({ campo: 'pedido', operador: 'mayor_igual', valor: '50' })
    expect(parsearPildora('pedido<=50')).toMatchObject({ campo: 'pedido', operador: 'menor_igual', valor: '50' })
  })

  it('acepta paréntesis y mayúsculas alrededor del nombre de campo', () => {
    expect(parsearPildora('(Pedido):20')).toMatchObject({ campo: 'pedido', operador: 'contiene', valor: '20' })
    expect(parsearPildora('ENVIO:7')).toMatchObject({ campo: 'envio', operador: 'contiene', valor: '7' })
  })

  it('acepta alias de campo (código→sku, prod/nombre→producto, ped→pedido)', () => {
    expect(parsearPildora('codigo:ABC')).toMatchObject({ campo: 'sku' })
    expect(parsearPildora('prod:coca')).toMatchObject({ campo: 'producto' })
    expect(parsearPildora('ped:5')).toMatchObject({ campo: 'pedido' })
  })

  it('no reconoce texto sin operador, campo desconocido, o sin valor → null (queda como libre)', () => {
    expect(parsearPildora('LPN-2026080312345')).toBeNull() // LPN física de barcode, sin ":"
    expect(parsearPildora('noexiste:20')).toBeNull()
    expect(parsearPildora('pedido:')).toBeNull()
    expect(parsearPildora('')).toBeNull()
    expect(parsearPildora('   ')).toBeNull()
  })
})

describe('operadoresValidosParaCampo / esCampoNumerico', () => {
  it('LPN/SKU/Producto son de texto: solo contiene/no_contiene', () => {
    for (const campo of ['lpn', 'sku', 'producto'] as const) {
      expect(esCampoNumerico(campo)).toBe(false)
      expect(operadoresValidosParaCampo(campo).map(o => o.operador)).toEqual(['contiene', 'no_contiene'])
    }
  })

  it('Pedido/Venta/Envío son numéricos: los 6 operadores', () => {
    for (const campo of ['pedido', 'venta', 'envio'] as const) {
      expect(esCampoNumerico(campo)).toBe(true)
      expect(operadoresValidosParaCampo(campo).map(o => o.operador)).toEqual(
        ['contiene', 'no_contiene', 'mayor', 'menor', 'mayor_igual', 'menor_igual'],
      )
    }
  })
})

describe('operadorAjustado', () => {
  it('mantiene el operador si sigue siendo válido para el campo nuevo', () => {
    expect(operadorAjustado('mayor', 'venta')).toBe('mayor')
  })

  it('clampa a "contiene" si el operador deja de tener sentido (numérico → texto)', () => {
    expect(operadorAjustado('mayor', 'sku')).toBe('contiene')
    expect(operadorAjustado('menor_igual', 'lpn')).toBe('contiene')
  })
})

describe('formatearPildora', () => {
  it('formatea "(Campo)operador valor"', () => {
    const p: Pildora = { id: '1', campo: 'pedido', operador: 'contiene', valor: '20' }
    expect(formatearPildora(p)).toBe('(Pedido):20')
  })

  it('una píldora libre se muestra tal cual, sin paréntesis', () => {
    const p: Pildora = { id: '1', campo: 'libre', operador: 'contiene', valor: 'coca' }
    expect(formatearPildora(p)).toBe('coca')
  })
})

describe('evaluarPildora', () => {
  const tarea: TareaFiltrable = {
    lpn_origen: 'LPN-ABC-001',
    productos: { sku: 'SKU-4312', nombre: 'Coca Cola 2.5L' },
    pedidos: { numero: 20 },
    envios: { numero: 44 },
  }

  it('libre matchea por LPN, SKU o nombre de producto (contains, case-insensitive)', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'libre', operador: 'contiene', valor: 'coca' }, null)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'libre', operador: 'contiene', valor: 'sku-43' }, null)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'libre', operador: 'contiene', valor: 'zzz' }, null)).toBe(false)
  })

  it('libre NUNCA matchea pedido/venta/envío — para eso hace falta una píldora explícita (el bug que se corrige)', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'libre', operador: 'contiene', valor: '20' }, null)).toBe(false)
    expect(evaluarPildora(tarea, { id: '1', campo: 'libre', operador: 'contiene', valor: '44' }, null)).toBe(false)
  })

  it('(Pedido):20 matchea por CONTAINS, no exacto — pedido 20 y también un hipotético 120', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'contiene', valor: '20' }, null)).toBe(true)
    const tareaPedido120: TareaFiltrable = { ...tarea, pedidos: { numero: 120 } }
    expect(evaluarPildora(tareaPedido120, { id: '1', campo: 'pedido', operador: 'contiene', valor: '20' }, null)).toBe(true)
  })

  it('(Venta) usa el ventaNumero pasado aparte (no viene de la tarea)', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'venta', operador: 'contiene', valor: '395' }, 395)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'venta', operador: 'contiene', valor: '395' }, 12)).toBe(false)
    expect(evaluarPildora(tarea, { id: '1', campo: 'venta', operador: 'contiene', valor: '395' }, null)).toBe(false)
  })

  it('no_contiene es el negado exacto de contiene', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'sku', operador: 'no_contiene', valor: '4312' }, null)).toBe(false)
    expect(evaluarPildora(tarea, { id: '1', campo: 'sku', operador: 'no_contiene', valor: 'zzz' }, null)).toBe(true)
  })

  it('operadores numéricos comparan el número real, no substring', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'mayor', valor: '10' }, null)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'mayor', valor: '20' }, null)).toBe(false)
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'mayor_igual', valor: '20' }, null)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'menor', valor: '30' }, null)).toBe(true)
    expect(evaluarPildora(tarea, { id: '1', campo: 'pedido', operador: 'menor_igual', valor: '20' }, null)).toBe(true)
  })

  it('campo ausente (null) nunca matchea un operador numérico', () => {
    const sinEnvio: TareaFiltrable = { ...tarea, envios: { numero: null } }
    expect(evaluarPildora(sinEnvio, { id: '1', campo: 'envio', operador: 'mayor', valor: '1' }, null)).toBe(false)
  })

  it('valor vacío en la píldora matchea siempre (todavía se está tipeando)', () => {
    expect(evaluarPildora(tarea, { id: '1', campo: 'sku', operador: 'contiene', valor: '' }, null)).toBe(true)
  })
})

describe('evaluarPildoras (combinación Y/O)', () => {
  const tarea: TareaFiltrable = {
    lpn_origen: 'LPN-1',
    productos: { sku: 'SKU-43', nombre: 'Coca Cola' },
    pedidos: { numero: 20 },
    envios: { numero: 44 },
  }
  const pedido20: Pildora = { id: '1', campo: 'pedido', operador: 'contiene', valor: '20' }
  const sku43: Pildora = { id: '2', campo: 'sku', operador: 'contiene', valor: '43' }
  const skuZZZ: Pildora = { id: '3', campo: 'sku', operador: 'contiene', valor: 'zzz' }

  it('sin píldoras: todo pasa', () => {
    expect(evaluarPildoras(tarea, [], 'Y', null)).toBe(true)
  })

  it('"(Pedido):20 Y (SKU):43" — el ejemplo exacto del pedido de GO', () => {
    expect(evaluarPildoras(tarea, [pedido20, sku43], 'Y', null)).toBe(true)
    expect(evaluarPildoras(tarea, [pedido20, skuZZZ], 'Y', null)).toBe(false) // Y exige las dos
  })

  it('combinador O: alcanza con que UNA matchee', () => {
    expect(evaluarPildoras(tarea, [pedido20, skuZZZ], 'O', null)).toBe(true)
    expect(evaluarPildoras(tarea, [skuZZZ, { id: '4', campo: 'pedido', operador: 'contiene', valor: '999' }], 'O', null)).toBe(false)
  })
})
