import { describe, it, expect } from 'vitest'
import {
  mesesDeFrecuencia, proximoVencimiento, servicioVencido, periodosVencidos,
  normalizarNombre, compararPresupuestos, type PresupuestoComparable,
} from '@/lib/serviciosRecurrentes'

// Compras CO7b — servicios recurrentes (F1) + comparación de presupuestos (F3)

describe('frecuencia (F1)', () => {
  it('mapea meses', () => {
    expect(mesesDeFrecuencia('mensual')).toBe(1)
    expect(mesesDeFrecuencia('trimestral')).toBe(3)
    expect(mesesDeFrecuencia('anual')).toBe(12)
    expect(mesesDeFrecuencia(null)).toBe(1)
  })
  it('proximoVencimiento suma meses', () => {
    expect(proximoVencimiento('2026-01-15', 'mensual')).toBe('2026-02-15')
    expect(proximoVencimiento('2026-01-15', 'trimestral')).toBe('2026-04-15')
    expect(proximoVencimiento('2026-06-15', 'anual')).toBe('2027-06-15')
  })
})

describe('servicioVencido (F1)', () => {
  it('recurrente activo con vencimiento <= hoy → vencido', () => {
    expect(servicioVencido({ recurrente: true, activo: true, proximo_vencimiento: '2026-06-01' }, '2026-06-08')).toBe(true)
    expect(servicioVencido({ recurrente: true, activo: true, proximo_vencimiento: '2026-06-08' }, '2026-06-08')).toBe(true)
  })
  it('vencimiento futuro → no vencido', () => {
    expect(servicioVencido({ recurrente: true, activo: true, proximo_vencimiento: '2026-07-01' }, '2026-06-08')).toBe(false)
  })
  it('no recurrente o inactivo → no vencido', () => {
    expect(servicioVencido({ recurrente: false, proximo_vencimiento: '2026-06-01' }, '2026-06-08')).toBe(false)
    expect(servicioVencido({ recurrente: true, activo: false, proximo_vencimiento: '2026-06-01' }, '2026-06-08')).toBe(false)
  })
})

describe('periodosVencidos (F1)', () => {
  it('cuenta períodos acumulados', () => {
    // mensual desde 2026-04-08, hoy 2026-06-08 → 04, 05, 06 = 3
    expect(periodosVencidos({ recurrente: true, activo: true, proximo_vencimiento: '2026-04-08' }, 'mensual', '2026-06-08')).toBe(3)
  })
  it('no vencido → 0', () => {
    expect(periodosVencidos({ recurrente: true, activo: true, proximo_vencimiento: '2026-07-01' }, 'mensual', '2026-06-08')).toBe(0)
  })
})

describe('normalizarNombre', () => {
  it('quita tildes, baja a minúsculas, colapsa espacios', () => {
    expect(normalizarNombre('  Diseño   Gráfico ')).toBe('diseno grafico')
  })
})

describe('compararPresupuestos (F3)', () => {
  const ps: PresupuestoComparable[] = [
    { id: 'a', servicio_nombre: 'Limpieza', proveedor_nombre: 'Prov A', monto: 5000 },
    { id: 'b', servicio_nombre: 'limpieza', proveedor_nombre: 'Prov B', monto: 4200 },
    { id: 'c', servicio_nombre: 'Contaduría', proveedor_nombre: 'Prov C', monto: 9000 },
  ]
  it('agrupa por concepto normalizado y marca el más barato', () => {
    const grupos = compararPresupuestos(ps)
    const limpieza = grupos.find(g => g.concepto.toLowerCase() === 'limpieza')!
    expect(limpieza.presupuestos.length).toBe(2)
    expect(limpieza.montoMin).toBe(4200)
    expect(limpieza.idMin).toBe('b')
  })
  it('ordena los comparables (más de uno) primero', () => {
    const grupos = compararPresupuestos(ps)
    expect(grupos[0].presupuestos.length).toBe(2)  // limpieza tiene 2
  })
  it('ordena presupuestos por monto ascendente dentro del grupo', () => {
    const grupos = compararPresupuestos(ps)
    const limpieza = grupos.find(g => g.presupuestos.length === 2)!
    expect(limpieza.presupuestos[0].monto).toBe(4200)
    expect(limpieza.presupuestos[1].monto).toBe(5000)
  })
})
