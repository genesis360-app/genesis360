import { describe, it, expect } from 'vitest'
import { estadoTrial, tituloPlanes, subtituloPlanes } from '@/lib/estadoTrial'

// Plan: bug real (GO, 2026-09-12) — entró a PROD con el trial vencido hacía 25 días y la pantalla
// de planes decía "¡Tu prueba gratuita está por vencer!". Ya había vencido, y la interrupción ya
// había ocurrido. Al momento del fix, 5 de los 6 tenants en trial de PROD estaban en ese estado.

const AHORA = new Date('2026-09-12T12:00:00Z')
const d = (iso: string) => ({ now: AHORA, trialEndsAt: iso, subscriptionStatus: 'trial' })

// ─────────────────────────────────────────────────────────────────────────────
// estadoTrial (ET-FASE)
// ─────────────────────────────────────────────────────────────────────────────
describe('estadoTrial', () => {
  it('🛑 ET-FASE-01 el caso REAL del bug: vencido hace 25 días NO es "por vencer"', () => {
    const e = estadoTrial(d('2026-08-17T21:24:53Z'))
    expect(e.fase).toBe('vencido')
    expect(e.dias).toBe(26)   // 25 días y fracción → se redondea hacia arriba
  })

  it('ET-FASE-02 dentro del trial y lejos del final → vigente', () => {
    expect(estadoTrial(d('2026-10-12T12:00:00Z')).fase).toBe('vigente')
  })

  it('ET-FASE-03 faltando menos de una semana → por_vencer', () => {
    const e = estadoTrial(d('2026-09-15T12:00:00Z'))
    expect(e.fase).toBe('por_vencer')
    expect(e.dias).toBe(3)
  })

  it('ET-FASE-04 el borde exacto: vencido hace un instante ya es "vencido"', () => {
    expect(estadoTrial(d('2026-09-12T11:59:00Z')).fase).toBe('vencido')
  })

  it('ET-FASE-05 recién vencido informa "1 día", nunca 0', () => {
    // Sin el redondeo hacia arriba, las primeras 24 h decían "hace 0 días".
    expect(estadoTrial(d('2026-09-12T06:00:00Z')).dias).toBe(1)
  })

  it('ET-FASE-06 un tenant que NO está en trial no habla de la prueba', () => {
    expect(estadoTrial({ ...d('2026-08-17T00:00:00Z'), subscriptionStatus: 'active' }).fase).toBe('sin_trial')
    expect(estadoTrial({ ...d('2026-08-17T00:00:00Z'), subscriptionStatus: 'cancelled' }).fase).toBe('sin_trial')
  })

  it('ET-FASE-07 sin fecha de fin o con fecha inválida no rompe', () => {
    expect(estadoTrial({ now: AHORA, trialEndsAt: null, subscriptionStatus: 'trial' }).fase).toBe('sin_trial')
    expect(estadoTrial(d('no-es-fecha')).fase).toBe('sin_trial')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Los textos (ET-TXT) — son el bug en sí, así que se testean
// ─────────────────────────────────────────────────────────────────────────────
describe('tituloPlanes', () => {
  it('🛑 ET-TXT-01 vencido NO puede decir "está por vencer"', () => {
    const t = tituloPlanes(estadoTrial(d('2026-08-17T21:24:53Z')), 'Don Ferretero')
    expect(t).toMatch(/venció/i)
    expect(t).not.toMatch(/por vencer/i)
    // Nombra el negocio: un usuario puede no recordar cuál cuenta es.
    expect(t).toContain('Don Ferretero')
  })

  it('ET-TXT-02 sin nombre de negocio igual dice que venció', () => {
    expect(tituloPlanes(estadoTrial(d('2026-08-17T00:00:00Z')), null)).toMatch(/venció/i)
  })

  it('ET-TXT-03 por vencer dice CUÁNTO falta, no un genérico', () => {
    expect(tituloPlanes(estadoTrial(d('2026-09-15T12:00:00Z')))).toMatch(/vence en 3 días/i)
  })

  it('ET-TXT-04 el último día dice "mañana", no "en 1 días"', () => {
    expect(tituloPlanes(estadoTrial(d('2026-09-13T10:00:00Z')))).toMatch(/mañana/i)
  })
})

describe('subtituloPlanes', () => {
  it('🛑 ET-TXT-05 vencido NO promete "sin interrupciones" — la interrupción ya pasó', () => {
    const s = subtituloPlanes(estadoTrial(d('2026-08-17T21:24:53Z')), '2026-08-17T21:24:53Z')
    expect(s).not.toMatch(/sin interrupciones/i)
    expect(s).toMatch(/17\/08\/2026/)          // la fecha exacta
    expect(s).toMatch(/hace 26 días/)          // y los días, para no obligar a la cuenta mental
    expect(s).toMatch(/datos están intactos/i) // lo que más necesita saber quien quedó afuera
  })

  it('ET-TXT-06 vencido ayer dice "ayer", no "hace 1 días"', () => {
    expect(subtituloPlanes(estadoTrial(d('2026-09-11T18:00:00Z')), '2026-09-11T18:00:00Z'))
      .toMatch(/ayer/i)
  })

  it('ET-TXT-07 por vencer sí puede prometer continuidad: todavía está adentro', () => {
    expect(subtituloPlanes(estadoTrial(d('2026-09-15T12:00:00Z')), '2026-09-15T12:00:00Z'))
      .toMatch(/sin interrupciones/i)
  })

  it('ET-TXT-08 sin trial, el mensaje comercial de siempre', () => {
    const e = estadoTrial({ ...d('2026-08-17T00:00:00Z'), subscriptionStatus: 'active' })
    expect(subtituloPlanes(e, null)).toMatch(/30 días de prueba/i)
  })
})
