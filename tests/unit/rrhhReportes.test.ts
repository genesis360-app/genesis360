import { describe, it, expect } from 'vitest'
import {
  costoLaboralPorDepto, asistenciaConsolidada, vacacionesResumen,
  antiguedadRotacion, recibosResumen,
} from '@/lib/rrhhReportes'

// RRHH RH8 — reportes

describe('costoLaboralPorDepto (G1)', () => {
  it('suma haberes BRUTOS (total_haberes) por departamento, no el neto', () => {
    const r = costoLaboralPorDepto([
      { empleado_id: '1', departamento: 'Ventas', periodo: '2026-06-01', bruto: 130000, neto: 100000, pagado: true },
      { empleado_id: '2', departamento: 'Ventas', periodo: '2026-06-01', bruto: 105000, neto: 80000, pagado: false },
      { empleado_id: '3', departamento: 'Depósito', periodo: '2026-06-01', bruto: 117000, neto: 90000, pagado: true },
    ])
    // costo laboral = bruto (lo que paga la empresa), no el neto del empleado
    expect(r[0]).toMatchObject({ departamento: 'Ventas', total: 235000, cantidad: 2 })
  })

  it('cae a neto si no viene el bruto (defensivo)', () => {
    const r = costoLaboralPorDepto([
      { empleado_id: '1', departamento: 'Ventas', periodo: '2026-06-01', neto: 90000, pagado: true },
    ])
    expect(r[0]).toMatchObject({ departamento: 'Ventas', total: 90000, cantidad: 1 })
  })
})

describe('asistenciaConsolidada (G1)', () => {
  it('cuenta estados por empleado', () => {
    const r = asistenciaConsolidada([
      { empleado_id: '1', empleado: 'Ana', estado: 'presente' },
      { empleado_id: '1', empleado: 'Ana', estado: 'tardanza' },
      { empleado_id: '1', empleado: 'Ana', estado: 'presente' },
    ])
    expect(r[0]).toMatchObject({ empleado: 'Ana', presente: 2, tardanza: 1, ausente: 0, licencia: 0 })
  })
})

describe('vacacionesResumen (G1)', () => {
  it('asignados = totales + remanente, disponibles = asignados - usados', () => {
    const r = vacacionesResumen([{ empleado: 'Ana', dias_totales: 21, dias_usados: 5, remanente_anterior: 3 }])
    expect(r[0]).toMatchObject({ asignados: 24, usados: 5, disponibles: 19 })
  })
})

describe('antiguedadRotacion (G1)', () => {
  it('cuenta activos/bajas y permanencia promedio', () => {
    const r = antiguedadRotacion([
      { id: '1', fecha_ingreso: '2020-06-09', activo: true },
      { id: '2', fecha_ingreso: '2024-06-09', activo: true },
      { id: '3', fecha_ingreso: '2019-01-01', fecha_egreso: '2025-01-01', activo: false },
    ], '2026-06-09')
    expect(r.activos).toBe(2)
    expect(r.bajas).toBe(1)
    expect(r.permanenciaPromedioAnios).toBe(4) // (6 + 2) / 2
  })
})

describe('recibosResumen (G1)', () => {
  it('separa pagados de pendientes', () => {
    const r = recibosResumen([
      { empleado_id: '1', periodo: '2026-06-01', neto: 100000, pagado: true },
      { empleado_id: '2', periodo: '2026-06-01', neto: 80000, pagado: false },
    ])
    expect(r).toMatchObject({ pagadosCant: 1, pagadosMonto: 100000, pendientesCant: 1, pendientesMonto: 80000 })
  })
})
