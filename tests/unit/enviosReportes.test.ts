import { describe, it, expect } from 'vitest'
import {
  pendientesAtrasados, cumplimientoPorCourier, pagosCourierPorMes,
  margenLogistico, distribucionPorZona, alertasEnvios,
  type EnvioReporte,
} from '@/lib/enviosReportes'

// Envíos EN7 — H1 reportes + H2 alertas

const AHORA = new Date('2026-06-09T12:00:00Z')

function e(p: Partial<EnvioReporte> & { id: string }): EnvioReporte {
  return { estado: 'pendiente', created_at: '2026-06-09T12:00:00Z', ...p }
}

describe('pendientesAtrasados (H1-a)', () => {
  it('cuenta pendientes y marca atrasados sobre el umbral', () => {
    const envios = [
      e({ id: '1', estado: 'pendiente', created_at: '2026-06-07T12:00:00Z' }), // 48h
      e({ id: '2', estado: 'pendiente', created_at: '2026-06-09T06:00:00Z' }), // 6h
      e({ id: '3', estado: 'entregado', created_at: '2026-06-01T12:00:00Z' }),
    ]
    const r = pendientesAtrasados(envios, 24, AHORA)
    expect(r.pendientes).toBe(2)
    expect(r.atrasados).toBe(1)
    expect(r.lista[0].id).toBe('1') // ordenado por horas desc
  })
})

describe('cumplimientoPorCourier (H1-b)', () => {
  it('% entregados + tiempo medio en días', () => {
    const envios = [
      e({ id: '1', courier: 'Andreani', estado: 'entregado', created_at: '2026-06-01T12:00:00Z', pod_fecha: '2026-06-03' }), // 2d
      e({ id: '2', courier: 'Andreani', estado: 'en_camino', created_at: '2026-06-05T12:00:00Z' }),
      e({ id: '3', courier: 'Andreani', estado: 'entregado', created_at: '2026-06-01T12:00:00Z', pod_fecha: '2026-06-05' }), // 4d
    ]
    const r = cumplimientoPorCourier(envios)
    expect(r[0].courier).toBe('Andreani')
    expect(r[0].total).toBe(3)
    expect(r[0].entregados).toBe(2)
    expect(r[0].pctEntregados).toBe(67)
    expect(r[0].tiempoMedioDias).toBe(3) // (2+4)/2
  })
  it('excluye cancelados', () => {
    const r = cumplimientoPorCourier([e({ id: '1', courier: 'OCA', estado: 'cancelado' })])
    expect(r.length).toBe(0)
  })
})

describe('pagosCourierPorMes (H1-c)', () => {
  it('agrupa pagados por mes y courier, excluye propio', () => {
    const envios = [
      e({ id: '1', courier: 'Andreani', costo_pagado: true, fecha_pago_courier: '2026-06-05', costo_cotizado: 1000 }),
      e({ id: '2', courier: 'Andreani', costo_pagado: true, fecha_pago_courier: '2026-06-20', costo_cotizado: 500 }),
      e({ id: '3', courier: 'Envío propio', costo_pagado: true, fecha_pago_courier: '2026-06-05', costo_cotizado: 300 }),
      e({ id: '4', courier: 'OCA', costo_pagado: false, costo_cotizado: 800 }),
    ]
    const r = pagosCourierPorMes(envios)
    expect(r.length).toBe(1)
    expect(r[0]).toMatchObject({ mes: '2026-06', courier: 'Andreani', total: 1500, cantidad: 2 })
  })
})

describe('margenLogistico (H1-d)', () => {
  it('ingreso − costo real, cuenta subsidiados', () => {
    const envios = [
      e({ id: '1', estado: 'entregado', venta_costo_envio: 1000, costo_real: 600 }),  // +400
      e({ id: '2', estado: 'entregado', venta_costo_envio: 500, costo_cotizado: 800 }), // -300 subsidiado
    ]
    const r = margenLogistico(envios)
    expect(r.ingresoTotal).toBe(1500)
    expect(r.costoTotal).toBe(1400)
    expect(r.margenTotal).toBe(100)
    expect(r.subsidiados).toBe(1)
    expect(r.lista[0].margen).toBe(-300) // ordenado por margen asc
  })
})

describe('distribucionPorZona (H1-e)', () => {
  it('agrupa por zona con fallback a CP', () => {
    const envios = [
      e({ id: '1', zona_entrega: 'Centro', estado: 'entregado' }),
      e({ id: '2', zona_entrega: 'Centro', estado: 'pendiente' }),
      e({ id: '3', codigo_postal: '5000', estado: 'entregado' }),
    ]
    const r = distribucionPorZona(envios)
    expect(r[0]).toMatchObject({ zona: 'Centro', total: 2, entregados: 1, pctEntregados: 50 })
    expect(r.find(z => z.zona === '5000')?.total).toBe(1)
  })
})

describe('alertasEnvios (H2)', () => {
  const cfg = { sinDespachoHoras: 24, podPendienteDias: 3, pagoCourierDias: 7, diferenciaPct: 15 }
  it('dispara cada tipo de alerta sobre su umbral', () => {
    const envios = [
      e({ id: 'a', estado: 'pendiente', created_at: '2026-06-07T12:00:00Z' }), // 48h sin despachar
      e({ id: 'b', estado: 'entregado', created_at: '2026-06-01T12:00:00Z', pod_fecha: null }), // POD pendiente
      e({ id: 'c', estado: 'en_camino', courier: 'OCA', costo_cotizado: 800, costo_pagado: false, created_at: '2026-05-30T12:00:00Z' }), // pago courier
      e({ id: 'd', estado: 'entregado', costo_cotizado: 1000, diferencia_monto: 300, diferencia_tipo: 'perdida', pod_fecha: '2026-06-08' }), // dif 30%
    ]
    const r = alertasEnvios(envios, cfg, AHORA)
    expect(r.sinDespachar.map(x => x.id)).toContain('a')
    expect(r.podPendiente.map(x => x.id)).toContain('b')
    expect(r.pagoCourierPendiente.map(x => x.id)).toContain('c')
    expect(r.diferenciaImportante.map(x => x.id)).toContain('d')
    expect(r.total).toBeGreaterThanOrEqual(4)
  })
  it('no dispara pago courier para envío propio', () => {
    const envios = [e({ id: 'p', estado: 'en_camino', courier: 'Envío propio', costo_cotizado: 500, costo_pagado: false, created_at: '2026-05-01T12:00:00Z' })]
    const r = alertasEnvios(envios, cfg, AHORA)
    expect(r.pagoCourierPendiente.length).toBe(0)
  })
})
