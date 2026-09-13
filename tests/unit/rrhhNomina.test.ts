import { describe, it, expect } from 'vitest'
import {
  montoConcepto, montoBeneficio, calcularItemsNomina,
  mejorSueldoSemestre, sacMejorSueldo, agruparCargasSociales,
  type ConceptoNomina,
} from '@/lib/rrhhNomina'

// RRHH RH2 — aportes AR + SAC

const JUBILACION: ConceptoNomina = { id: 'j', nombre: 'Jubilación', tipo: 'DESCUENTO', tipo_calculo: 'sobre_bruto', default_pct: 11, es_aporte: true }
const OS: ConceptoNomina = { id: 'os', nombre: 'Obra Social', tipo: 'DESCUENTO', tipo_calculo: 'sobre_bruto', default_pct: 3, es_aporte: true }
const LEY: ConceptoNomina = { id: 'ley', nombre: 'Ley 19.032', tipo: 'DESCUENTO', tipo_calculo: 'sobre_bruto', default_pct: 3, es_aporte: true }

describe('montoConcepto (B4)', () => {
  it('porcentaje sobre la base', () => {
    expect(montoConcepto(JUBILACION, 100000)).toBe(11000)
  })
  it('fijo usa default_monto', () => {
    expect(montoConcepto({ id: 'x', nombre: 'Sindicato', tipo: 'DESCUENTO', tipo_calculo: 'fijo', default_monto: 2500 }, 100000)).toBe(2500)
  })
})

describe('montoBeneficio (B4)', () => {
  it('monto fijo', () => {
    expect(montoBeneficio({ nombre: 'Premio', tipo: 'monto', valor: 5000 }, 100000)).toBe(5000)
  })
  it('porcentaje', () => {
    expect(montoBeneficio({ nombre: 'Presentismo', tipo: 'porcentaje', valor: 10 }, 100000)).toBe(10000)
  })
})

describe('calcularItemsNomina (B4)', () => {
  it('básico + aportes activos → totales y neto', () => {
    const r = calcularItemsNomina(100000, [JUBILACION, OS, LEY], ['j', 'os', 'ley'])
    expect(r.totalHaberes).toBe(100000)
    expect(r.totalDescuentos).toBe(17000) // 11000+3000+3000
    expect(r.neto).toBe(83000)
    expect(r.items.find(i => i.descripcion === 'Sueldo básico')?.monto).toBe(100000)
  })
  it('empleado "en negro": sin aportes activos → neto = bruto', () => {
    const r = calcularItemsNomina(100000, [JUBILACION, OS, LEY], [])
    expect(r.totalDescuentos).toBe(0)
    expect(r.neto).toBe(100000)
  })
  it('solo prende los aportes en el set del empleado', () => {
    const r = calcularItemsNomina(100000, [JUBILACION, OS, LEY], ['j'])
    expect(r.totalDescuentos).toBe(11000)
  })
  it('beneficios extra suman a haberes', () => {
    const r = calcularItemsNomina(100000, [], [], [{ nombre: 'Premio', tipo: 'monto', valor: 5000 }, { nombre: 'Presentismo', tipo: 'porcentaje', valor: 10 }])
    expect(r.totalHaberes).toBe(115000) // 100000 + 5000 + 10000
    expect(r.neto).toBe(115000)
  })
})

describe('SAC (B5)', () => {
  it('mejor sueldo del semestre = el mayor', () => {
    expect(mejorSueldoSemestre([90000, 120000, 110000])).toBe(120000)
  })
  it('SAC = 50% del mejor sueldo (semestre completo)', () => {
    expect(sacMejorSueldo(120000)).toBe(60000)
  })
  it('SAC proporcional por meses trabajados', () => {
    expect(sacMejorSueldo(120000, 3)).toBe(30000) // 50% × 120000 × 3/6
  })
})

// ── mig 409 — cargas sociales imputadas a la sucursal del empleado ──────────────────────────
// Antes se acumulaban solo por CONCEPTO, en una bolsa única del negocio: las cargas de todas las
// sucursales terminaban en un gasto que no se podía imputar a ninguna y que el módulo Gastos
// (filtra por la sucursal activa) no mostraba en ninguna.
describe('agruparCargasSociales', () => {
  const esAporte = (id: string | null | undefined) => id === 'jub' || id === 'os'
  const sucursales = new Map<string, string | null>([
    ['sal-1', 'norte'], ['sal-2', 'norte'], ['sal-3', 'sur'], ['sal-4', null],
  ])

  it('separa el mismo concepto por sucursal en vez de mezclarlo', () => {
    const r = agruparCargasSociales([
      { salario_id: 'sal-1', descripcion: 'Jubilación', monto: 100, concepto_id: 'jub' },
      { salario_id: 'sal-2', descripcion: 'Jubilación', monto: 50, concepto_id: 'jub' },
      { salario_id: 'sal-3', descripcion: 'Jubilación', monto: 70, concepto_id: 'jub' },
    ], sucursales, esAporte)
    expect(r).toEqual([
      { concepto: 'Jubilación', sucursalId: 'norte', monto: 150 },
      { concepto: 'Jubilación', sucursalId: 'sur', monto: 70 },
    ])
  })

  it('los empleados sin sucursal quedan juntos como gasto global, no repartidos', () => {
    const r = agruparCargasSociales([
      { salario_id: 'sal-4', descripcion: 'Obra social', monto: 30, concepto_id: 'os' },
      { salario_id: 'sal-1', descripcion: 'Obra social', monto: 20, concepto_id: 'os' },
    ], sucursales, esAporte)
    expect(r).toContainEqual({ concepto: 'Obra social', sucursalId: null, monto: 30 })
    expect(r).toContainEqual({ concepto: 'Obra social', sucursalId: 'norte', monto: 20 })
  })

  it('ignora los ítems que no son aportes', () => {
    expect(agruparCargasSociales([
      { salario_id: 'sal-1', descripcion: 'Adelanto', monto: 999, concepto_id: 'otro' },
      { salario_id: 'sal-1', descripcion: 'Adelanto', monto: 999, concepto_id: null },
    ], sucursales, esAporte)).toEqual([])
  })

  it('suma montos que llegan como string (numeric de Postgres)', () => {
    expect(agruparCargasSociales([
      { salario_id: 'sal-1', descripcion: 'Jubilación', monto: '10.25', concepto_id: 'jub' },
      { salario_id: 'sal-1', descripcion: 'Jubilación', monto: '0.75', concepto_id: 'jub' },
    ], sucursales, esAporte)).toEqual([{ concepto: 'Jubilación', sucursalId: 'norte', monto: 11 }])
  })

  it('un salario que no está en el mapa cuenta como sin sucursal', () => {
    expect(agruparCargasSociales([
      { salario_id: 'desconocido', descripcion: 'Jubilación', monto: 5, concepto_id: 'jub' },
    ], sucursales, esAporte)).toEqual([{ concepto: 'Jubilación', sucursalId: null, monto: 5 }])
  })
})
