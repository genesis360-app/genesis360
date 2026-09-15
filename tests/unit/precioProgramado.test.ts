import { describe, it, expect } from 'vitest'
import {
  combinarFechaHora, validarVigencia, cambioDePrecio, vigenciaSugerida, formatearVigencia,
  etiquetaDesactualizada, etiquetaAntesDeHora, etiquetaVencida, etiquetaAnticipacion, ANTICIPACION_OPCIONES_MIN,
  type TareaEtiqueta,
} from '../../src/lib/precioProgramado'

describe('combinarFechaHora', () => {
  it('arma la fecha en hora local', () => {
    const d = combinarFechaHora('2026-09-20', '14:30')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 20, 14, 30])
  })

  it('rechaza formatos inválidos y fechas que no existen', () => {
    expect(combinarFechaHora('', '14:30')).toBeNull()
    expect(combinarFechaHora('2026-09-20', '')).toBeNull()
    expect(combinarFechaHora('20/09/2026', '14:30')).toBeNull()
    expect(combinarFechaHora('2026-02-31', '10:00')).toBeNull()
    expect(combinarFechaHora('2026-09-20', '25:00')).toBeNull()
  })
})

describe('validarVigencia', () => {
  const ahora = new Date(2026, 8, 14, 10, 0, 0)

  it('acepta una fecha futura razonable', () => {
    const r = validarVigencia('2026-09-15', '08:00', ahora)
    expect(r.ok).toBe(true)
  })

  it('🔴 CLAVE: rechaza el pasado y lo que está a menos de 2 minutos (la base exige 1)', () => {
    expect(validarVigencia('2026-09-14', '09:59', ahora).ok).toBe(false)
    expect(validarVigencia('2026-09-14', '10:01', ahora).ok).toBe(false)
    expect(validarVigencia('2026-09-14', '10:03', ahora).ok).toBe(true)
  })

  it('rechaza más de un año', () => {
    const r = validarVigencia('2027-10-01', '10:00', ahora)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/año/)
  })

  it('pide fecha y hora si faltan', () => {
    const r = validarVigencia('', '', ahora)
    expect(r.ok).toBe(false)
  })
})

describe('cambioDePrecio', () => {
  it('detecta un cambio real y normaliza el numeric que llega como string', () => {
    expect(cambioDePrecio('1500.00', 1600)).toBe(true)
    expect(cambioDePrecio('1500.00', '1500')).toBe(false)
  })

  it('ignora diferencias menores a medio centavo', () => {
    expect(cambioDePrecio(1500, 1500.004)).toBe(false)
    expect(cambioDePrecio(1500, 1500.01)).toBe(true)
  })
})

describe('vigenciaSugerida / formatearVigencia', () => {
  it('propone mañana a las 08:00', () => {
    expect(vigenciaSugerida(new Date(2026, 8, 30, 22, 15))).toEqual({ fecha: '2026-10-01', hora: '08:00' })
  })

  it('formatea dd/mm/aaaa hh:mm', () => {
    expect(formatearVigencia(new Date(2026, 8, 5, 7, 3))).toBe('05/09/2026 07:03')
    expect(formatearVigencia('no-es-fecha')).toBe('')
  })
})

// ── Fases 2-3 (mig 423) ───────────────────────────────────────────────────────────────────────────
const ahora = new Date('2026-09-15T12:00:00Z')
const enUnaHora = '2026-09-15T13:00:00Z'
const haceUnaHora = '2026-09-15T11:00:00Z'

const tarea = (t: Partial<TareaEtiqueta> = {}): TareaEtiqueta => ({
  tipo: 'cambio_precio', estado: 'pendiente', precio_anterior: '1000.00', precio_nuevo: '1250.00',
  precio_programado_id: null, vigente_desde: null, ...t,
})

describe('etiquetaDesactualizada (C3, aviso al cajero)', () => {
  it('🔴 CLAVE: la góndola dice $1000 y se cobra $1250 → avisa', () => {
    expect(etiquetaDesactualizada(tarea(), '1250.00')).toBe(true)
  })

  it('antes de la hora de un programado la etiqueta vieja es la correcta → no avisa', () => {
    const t = tarea({ precio_programado_id: 'pp', vigente_desde: enUnaHora })
    expect(etiquetaDesactualizada(t, '1000.00')).toBe(false)
  })

  it('no avisa por tareas cerradas, de estado o sin datos', () => {
    expect(etiquetaDesactualizada(tarea({ estado: 'completada' }), 1250)).toBe(false)
    expect(etiquetaDesactualizada(tarea({ tipo: 'cambio_estado' }), 1250)).toBe(false)
    expect(etiquetaDesactualizada(tarea({ precio_anterior: null }), 1250)).toBe(false)
    expect(etiquetaDesactualizada(tarea(), null)).toBe(false)
  })
})

describe('etiquetaAntesDeHora (C1/C2, espejo del guard)', () => {
  it('🔴 CLAVE: programado para dentro de una hora y rige el precio viejo → no se completa', () => {
    const t = tarea({ precio_programado_id: 'pp', vigente_desde: enUnaHora })
    expect(etiquetaAntesDeHora(t, '1000.00', ahora)).toBe(true)
  })

  it('pasada la hora, o si el precio vigente ya es el de la etiqueta, se puede completar', () => {
    expect(etiquetaAntesDeHora(tarea({ precio_programado_id: 'pp', vigente_desde: haceUnaHora }), 1000, ahora)).toBe(false)
    expect(etiquetaAntesDeHora(tarea({ precio_programado_id: 'pp', vigente_desde: enUnaHora }), '1250', ahora)).toBe(false)
  })

  it('una tarea común (sin programado) nunca queda trabada', () => {
    expect(etiquetaAntesDeHora(tarea(), 1000, ahora)).toBe(false)
  })
})

describe('etiquetaVencida (C3, alerta)', () => {
  it('programado cuya hora pasó y sigue pendiente → vencida', () => {
    expect(etiquetaVencida(tarea({ precio_programado_id: 'pp', vigente_desde: haceUnaHora }), ahora)).toBe(true)
  })

  it('no es vencida antes de la hora, sin programado ni cerrada', () => {
    expect(etiquetaVencida(tarea({ precio_programado_id: 'pp', vigente_desde: enUnaHora }), ahora)).toBe(false)
    expect(etiquetaVencida(tarea(), ahora)).toBe(false)
    expect(etiquetaVencida(tarea({ precio_programado_id: 'pp', vigente_desde: haceUnaHora, estado: 'completada' }), ahora)).toBe(false)
  })
})

describe('etiquetaAnticipacion', () => {
  it('describe cada opción y todas entran en el CHECK de la base (0-1440)', () => {
    expect(etiquetaAnticipacion(0)).toBe('A la hora del cambio')
    expect(etiquetaAnticipacion(30)).toBe('30 minutos antes')
    expect(etiquetaAnticipacion(60)).toBe('1 hora antes')
    expect(etiquetaAnticipacion(120)).toBe('2 horas antes')
    expect(etiquetaAnticipacion(1440)).toBe('Un día antes')
    expect(etiquetaAnticipacion(90)).toBe('90 minutos antes')
    for (const m of ANTICIPACION_OPCIONES_MIN) expect(m >= 0 && m <= 1440).toBe(true)
  })
})
