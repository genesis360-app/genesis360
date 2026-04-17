import { describe, it, expect } from 'vitest'
import { calcularLpnFuentes, type LineaDisponible } from '../../src/lib/ventasValidation'
import { getRebajeSort } from '../../src/lib/rebajeSort'

function linea(id: string, lpn: string | null, cantidad: number, cantidad_reservada = 0): LineaDisponible {
  return { id, lpn, cantidad, cantidad_reservada }
}

describe('calcularLpnFuentes', () => {
  it('una línea con suficiente stock — una fuente', () => {
    const result = calcularLpnFuentes([linea('L1', 'LPN-A', 10)], 3)
    expect(result).toMatchObject([{ linea_id: 'L1', lpn: 'LPN-A', cantidad: 3 }])
  })

  it('no incluye líneas con todo reservado', () => {
    const lineas = [
      linea('L1', 'LPN-A', 3, 3),  // 0 disponible
      linea('L2', 'LPN-B', 5, 0),
    ]
    const result = calcularLpnFuentes(lineas, 2)
    expect(result).toMatchObject([{ linea_id: 'L2', lpn: 'LPN-B', cantidad: 2 }])
  })

  it('span de dos líneas — dos fuentes', () => {
    const lineas = [
      linea('L1', 'LPN-A', 2, 0),
      linea('L2', 'LPN-B', 5, 0),
    ]
    const result = calcularLpnFuentes(lineas, 4)
    expect(result).toMatchObject([
      { linea_id: 'L1', lpn: 'LPN-A', cantidad: 2 },
      { linea_id: 'L2', lpn: 'LPN-B', cantidad: 2 },
    ])
  })

  it('reserva parcial: toma solo el disponible de la línea', () => {
    const lineas = [
      linea('L1', 'LPN-A', 5, 3),  // 2 disponibles
      linea('L2', 'LPN-B', 5, 0),
    ]
    const result = calcularLpnFuentes(lineas, 4)
    expect(result).toMatchObject([
      { linea_id: 'L1', lpn: 'LPN-A', cantidad: 2 },
      { linea_id: 'L2', lpn: 'LPN-B', cantidad: 2 },
    ])
  })

  it('lpn null (sin LPN asignado)', () => {
    const result = calcularLpnFuentes([linea('L1', null, 10)], 1)
    expect(result).toMatchObject([{ linea_id: 'L1', lpn: null, cantidad: 1 }])
  })

  it('cantidad = 0 → array vacío', () => {
    const result = calcularLpnFuentes([linea('L1', 'LPN-A', 10)], 0)
    expect(result).toEqual([])
  })

  it('sin líneas → array vacío', () => {
    const result = calcularLpnFuentes([], 5)
    expect(result).toEqual([])
  })

  it('stock insuficiente — devuelve lo que puede', () => {
    const lineas = [linea('L1', 'LPN-A', 2)]
    const result = calcularLpnFuentes(lineas, 10)
    expect(result).toMatchObject([{ linea_id: 'L1', lpn: 'LPN-A', cantidad: 2 }])
  })

  it('tres líneas — usa las primeras necesarias y para', () => {
    const lineas = [
      linea('L1', 'LPN-A', 2),
      linea('L2', 'LPN-B', 2),
      linea('L3', 'LPN-C', 2),
    ]
    const result = calcularLpnFuentes(lineas, 3)
    expect(result).toMatchObject([
      { linea_id: 'L1', lpn: 'LPN-A', cantidad: 2 },
      { linea_id: 'L2', lpn: 'LPN-B', cantidad: 1 },
    ])
    // No debe incluir L3
    expect(result.find(f => f.linea_id === 'L3')).toBeUndefined()
  })

  it('todas las líneas reservadas → array vacío', () => {
    const lineas = [
      linea('L1', 'LPN-A', 3, 3),
      linea('L2', 'LPN-B', 2, 2),
    ]
    const result = calcularLpnFuentes(lineas, 2)
    expect(result).toEqual([])
  })

  it('la primera línea tiene reserva parcial y la segunda cubre el resto', () => {
    const lineas = [
      linea('L1', 'LPN-A', 5, 4),  // solo 1 disponible
      linea('L2', 'LPN-B', 10, 0),
    ]
    const result = calcularLpnFuentes(lineas, 5)
    expect(result).toMatchObject([
      { linea_id: 'L1', lpn: 'LPN-A', cantidad: 1 },
      { linea_id: 'L2', lpn: 'LPN-B', cantidad: 4 },
    ])
  })
})

// ─── Integración: sort activo → calcularLpnFuentes ─────────────────────────
// Simula el flujo completo de agregarProducto: ordena las líneas con getRebajeSort
// y luego calcula qué LPNs se usan para cubrir la cantidad pedida.

function lineaCompleta(
  id: string, lpn: string | null, cantidad: number, cantidad_reservada: number,
  created_at: string, fecha_vencimiento?: string, prioridad = 0
) {
  return { id, lpn, cantidad, cantidad_reservada, created_at, fecha_vencimiento,
    ubicaciones: { prioridad, disponible_surtido: true } }
}

function sortearYFuentear(lineasRaw: any[], cantidad: number, regla: string, tieneVencimiento = false) {
  const sort = getRebajeSort(regla, null, tieneVencimiento)
  const sorted = [...lineasRaw].sort(sort)
  const lineasDisp: LineaDisponible[] = sorted.map(l => ({
    id: l.id, lpn: l.lpn, cantidad: l.cantidad, cantidad_reservada: l.cantidad_reservada
  }))
  return calcularLpnFuentes(lineasDisp, cantidad)
}

describe('sort + calcularLpnFuentes — elección correcta de LPNs', () => {
  const lA = lineaCompleta('L-A', 'LPN-A', 5, 0, '2024-01-01')  // más antiguo
  const lB = lineaCompleta('L-B', 'LPN-B', 5, 0, '2024-06-01')  // más reciente
  const lC = lineaCompleta('L-C', 'LPN-C', 5, 0, '2024-03-01')  // intermedio

  it('FIFO: elige el más antiguo primero (L-A)', () => {
    const result = sortearYFuentear([lB, lC, lA], 3, 'FIFO')
    expect(result[0].linea_id).toBe('L-A')
  })

  it('LIFO: elige el más reciente primero (L-B)', () => {
    const result = sortearYFuentear([lA, lC, lB], 3, 'LIFO')
    expect(result[0].linea_id).toBe('L-B')
  })

  it('FIFO con reserva: salta la línea más antigua si está reservada y elige la siguiente', () => {
    const lAReservado = { ...lA, cantidad_reservada: 5 }  // totalmente reservado
    const result = sortearYFuentear([lAReservado, lC, lB], 3, 'FIFO')
    expect(result[0].linea_id).toBe('L-C')  // segunda más antigua, primera disponible
  })

  it('FEFO con vencimiento: elige el que vence antes', () => {
    const l1 = lineaCompleta('L1', 'LPN-1', 5, 0, '2024-01-01', '2024-12-01')  // vence antes
    const l2 = lineaCompleta('L2', 'LPN-2', 5, 0, '2024-01-01', '2025-06-01')  // vence después
    const result = sortearYFuentear([l2, l1], 2, 'FEFO', true)
    expect(result[0].linea_id).toBe('L1')
  })

  it('LEFO con vencimiento: elige el que vence después', () => {
    const l1 = lineaCompleta('L1', 'LPN-1', 5, 0, '2024-01-01', '2024-12-01')
    const l2 = lineaCompleta('L2', 'LPN-2', 5, 0, '2024-01-01', '2025-06-01')  // vence después
    const result = sortearYFuentear([l1, l2], 2, 'LEFO', true)
    expect(result[0].linea_id).toBe('L2')
  })

  it('FEFO sin vencimiento → fallback FIFO (elige más antiguo)', () => {
    // tieneVencimiento=false → fallback a FIFO
    const result = sortearYFuentear([lB, lC, lA], 3, 'FEFO', false)
    expect(result[0].linea_id).toBe('L-A')
  })

  it('Manual: respeta la prioridad de ubicación (menor = primero)', () => {
    const l1 = lineaCompleta('L1', 'LPN-1', 5, 0, '2024-01-01', undefined, 10)  // prioridad 10
    const l2 = lineaCompleta('L2', 'LPN-2', 5, 0, '2024-06-01', undefined, 1)   // prioridad 1 → va primero
    const result = sortearYFuentear([l1, l2], 2, 'Manual')
    expect(result[0].linea_id).toBe('L2')
  })

  it('FIFO span 2 LPNs: 3u de L-A (5 total, 2 reservadas) + 2u de L-C', () => {
    const lAParc = { ...lA, cantidad_reservada: 2 }  // 3 disponibles
    const result = sortearYFuentear([lC, lAParc, lB], 5, 'FIFO')
    expect(result).toMatchObject([
      { linea_id: 'L-A', lpn: 'LPN-A', cantidad: 3 },
      { linea_id: 'L-C', lpn: 'LPN-C', cantidad: 2 },
    ])
  })
})
